/**
 * highdesert-live: the phone lines. One plain node:http handler, no framework.
 *
 * Paths are served as nginx forwards them, prefix included (`location ^~
 * /live-api/ { proxy_pass http://127.0.0.1:3005; }` — no URI part, so nothing
 * is stripped). The full API, with shapes, is in docs/live-chat.md.
 *
 * Who is calling: `client_ref` = HMAC-SHA256(clientKey(ip), CHAT_CLIENT_SECRET)
 * — the app's own bucketing (IPv4 address, IPv6 /64), shared by symlink
 * (lib/shared/client-key.ts). The address comes from X-Forwarded-For, which
 * nginx overwrites with $remote_addr, and is trusted only from a loopback peer.
 * The address itself is used for that one hash and never stored, logged or sent.
 */

import { hashClientKey, clientKey } from "./shared/client-key.ts";
import {
  MAX_BODY_BYTES,
  MAX_STREAMS,
  NAME_CHANGE_MS,
  RECENT_ON_HELLO,
  HIDDEN_REPLAY_MS,
  REPORTS_PER_MINUTE,
  REPORTS_TO_HIDE,
  REPORT_MUTE_MS,
  RETENTION_SWEEP_MS,
  RETRY_HINT_MS,
  SIGNIN_ATTEMPTS_PER_MINUTE,
  STREAMS_PER_CLIENT,
} from "./config.mjs";
import { createStore } from "./store.mjs";
import { createHub } from "./sse.mjs";
import { createLimits, createWindowCounter } from "./limits.mjs";
import { createModerator, REASON_TEXT } from "./moderation/index.mjs";
import { dedupKey } from "./moderation/normalize.mjs";
import { lineFor, LINES, randomCallerName } from "./names.mjs";
import { clearedCookie, isAdminRequest, sessionCookie, sha256hex } from "./admin.mjs";
import { SIGNIN_PAGE, SIGNIN_PAGE_HEADERS } from "./signin-page.mjs";
import { createCpuSampler } from "./cpu.mjs";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const DEFAULT_ORIGINS = ["https://highdesert.space", "https://www.highdesert.space"];

class HttpError extends Error {
  constructor(status, body, headers = {}) {
    super(body?.error ?? String(status));
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, { error: "too-large" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch {
        reject(new HttpError(400, { error: "bad-json" }));
      }
    });
    req.on("error", reject);
  });
}

const positiveInt = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);
const seconds = (ms) => Math.max(1, Math.ceil(ms / 1000));

/**
 * @param {object} o
 * @param {import("pg").Pool} o.pool
 * @param {string} o.clientSecret     CHAT_CLIENT_SECRET — keys client_ref
 * @param {string} o.adminToken       LIVE_ADMIN_TOKEN
 * @param {string[]} [o.origins]      allowed Origin values for POSTs
 * @param {() => {entries: any[], version: number}} [o.blocklist]
 * @param {boolean} [o.loadTest]      honour x-live-test-client from loopback (LIVE_LOAD_TEST=1 only)
 */
export function createLiveApp({
  pool,
  clientSecret,
  adminToken,
  origins = DEFAULT_ORIGINS,
  blocklist,
  loadTest = false,
  now = Date.now,
  heartbeatMs,
  log = (msg) => console.log(msg),
  /** Tests only: a private live_settings key, so parallel test apps do not share forced slow mode. */
  settingsKey,
}) {
  if (!clientSecret || clientSecret.length < 32) throw new Error("CHAT_CLIENT_SECRET must be set (32+ chars)");
  const store = createStore(pool, { settingsKey });
  const hub = createHub({ heartbeatMs });
  const limits = createLimits({ now });
  const moderate = createModerator(blocklist);
  const reportCounter = createWindowCounter({ max: REPORTS_PER_MINUTE, windowMs: 60_000, now });
  const signinCounter = createWindowCounter({ max: SIGNIN_ATTEMPTS_PER_MINUTE, windowMs: 60_000, now });
  const cpu = createCpuSampler();
  const bans = new Set();
  const startedAt = new Date(now()).toISOString();

  const ready = (async () => {
    for (const ref of await store.allBans()) bans.add(ref);
    limits.setForced(await store.getForcedSlow());
    await sweep();
  })();

  async function sweep() {
    try {
      const n = await store.sweep();
      if (n > 0) log(`[live] retention: deleted ${n} message(s) older than 7 days`);
    } catch (err) {
      log(`[live] retention sweep failed: ${err.message}`);
    }
  }
  const retentionTimer = setInterval(sweep, RETENTION_SWEEP_MS);
  retentionTimer.unref?.();

  // Slow mode turns itself off by time; tell the room when it does.
  let lastSlow = limits.slowMode();
  const slowTimer = setInterval(() => {
    limits.sweep();
    reportCounter.sweep();
    signinCounter.sweep();
    announceSlowIfChanged();
  }, 5_000);
  slowTimer.unref?.();
  function announceSlowIfChanged() {
    const s = limits.slowMode();
    if (s.on !== lastSlow.on || s.forced !== lastSlow.forced) {
      hub.broadcast("slow", s);
    }
    lastSlow = s;
  }

  // ---- identity ----------------------------------------------------------

  function clientAddress(req) {
    const peer = req.socket.remoteAddress ?? "";
    if (!LOOPBACK.has(peer)) return peer;
    const xff = req.headers["x-forwarded-for"];
    return (typeof xff === "string" && xff.split(",")[0].trim()) || peer;
  }

  function clientRefOf(req) {
    const peer = req.socket.remoteAddress ?? "";
    if (loadTest && LOOPBACK.has(peer) && typeof req.headers["x-live-test-client"] === "string") {
      return hashClientKey(`load:${req.headers["x-live-test-client"].slice(0, 64)}`, clientSecret);
    }
    return hashClientKey(clientKey(clientAddress(req)), clientSecret);
  }

  /** CSRF: JSON only, and only from our own origin. */
  function checkPost(req) {
    const type = String(req.headers["content-type"] ?? "");
    if (!/^application\/json\b/i.test(type)) throw new HttpError(415, { error: "json-only" });
    const origin = req.headers.origin;
    if (typeof origin !== "string" || !origins.includes(origin)) {
      throw new HttpError(403, { error: "bad-origin" });
    }
  }

  async function you(ref, req) {
    const name = await ensureName(ref);
    return { name, line: LINES[lineFor(ref)], admin: isAdminRequest(req, adminToken, now()) };
  }

  /** The caller's name, assigning a fresh unique one on first contact. */
  async function ensureName(ref) {
    const current = await store.getName(ref);
    if (current?.name) return current.name;
    for (let i = 0; i < 25; i++) {
      const name = randomCallerName();
      if ((await store.claimName(ref, name, { isConnected: hub.isConnected, markChanged: false })) === "ok") return name;
    }
    const fallback = `${randomCallerName()} ${String(now()).slice(-4)}`.slice(0, 40);
    await store.claimName(ref, fallback, { isConnected: hub.isConnected, markChanged: false });
    return fallback;
  }

  async function assertMayPost(ref) {
    if (bans.has(ref)) throw new HttpError(403, { error: "banned", message: "This line has been disconnected." });
    const mute = await store.activeMute(ref);
    if (mute) {
      const retryAfter = seconds(mute.until - now());
      throw new HttpError(
        403,
        { error: "muted", reason: mute.reason, retryAfter, message: "You're on hold for a few minutes." },
        { "retry-after": String(retryAfter) },
      );
    }
  }

  function requireAdmin(req) {
    if (!isAdminRequest(req, adminToken, now())) throw new HttpError(401, { error: "admin-only" });
  }

  async function messageOr404(id) {
    const m = positiveInt(id) && (await store.getMessage(id));
    if (!m) throw new HttpError(404, { error: "no-such-message" });
    return m;
  }

  async function hide(id, by) {
    if (await store.hideMessage(id, by)) hub.broadcast("hide", { ids: [id] });
  }

  // ---- routes ------------------------------------------------------------

  async function stream(req, res, url) {
    const ref = clientRefOf(req);
    if (bans.has(ref)) throw new HttpError(403, { error: "banned" });
    if (hub.streamsOf(ref) >= STREAMS_PER_CLIENT || hub.size >= MAX_STREAMS) {
      throw new HttpError(429, { error: "too-many-streams" }, { "retry-after": "30" });
    }
    const lastIdRaw = req.headers["last-event-id"] ?? url.searchParams.get("lastEventId");
    const lastId = positiveInt(Number(lastIdRaw));
    const [me, recent, hidden] = await Promise.all([
      you(ref, req),
      lastId ? store.visibleAfter(lastId, 200) : store.recentVisible(RECENT_ON_HELLO),
      store.recentlyHidden(HIDDEN_REPLAY_MS),
      store.touch(ref),
    ]);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: ${RETRY_HINT_MS}\n\n`);
    const client = hub.add(res, ref, () => {
      store.touch(ref).catch(() => {});
    });
    const lastSent = recent.length ? recent[recent.length - 1].id : lastId ?? undefined;
    hub.send(
      client,
      "hello",
      { you: me, slowMode: limits.slowMode(), recent, resumed: !!lastId, hidden },
      lastSent,
    );
  }

  async function postMessage(req, res) {
    checkPost(req);
    const body = await readJson(req);
    const ref = clientRefOf(req);
    await assertMayPost(ref);
    const pace = limits.pace(ref);
    if (!pace.ok) {
      const retryAfter = seconds(pace.retryAfterMs);
      throw new HttpError(429, { error: "rate", retryAfter, slowMode: limits.slowMode().on }, { "retry-after": String(retryAfter) });
    }
    if (typeof body.body !== "string") throw new HttpError(400, { error: "rejected", reason: "empty", message: REASON_TEXT.empty });
    const verdict = moderate.message(body.body);
    if (!verdict.ok) {
      throw new HttpError(400, { error: "rejected", reason: verdict.reason, message: REASON_TEXT[verdict.reason] });
    }
    const key = dedupKey(verdict.text);
    if (limits.duplicate(ref, key)) {
      throw new HttpError(400, { error: "rejected", reason: "duplicate", message: "You just said that." });
    }
    const name = await ensureName(ref);
    const msg = await store.insertMessage({ clientRef: ref, name, line: lineFor(ref), body: verdict.text });
    const turnedSlow = limits.record(ref, key);
    const out = { ...msg, line: LINES[msg.line] };
    hub.broadcast("message", out, msg.id);
    if (turnedSlow) announceSlowIfChanged();
    sendJson(res, 201, out);
  }

  async function postName(req, res) {
    checkPost(req);
    const body = await readJson(req);
    const ref = clientRefOf(req);
    await assertMayPost(ref);
    const wait = await store.renameWaitMs(ref);
    if (wait > 0) {
      const retryAfter = seconds(wait);
      throw new HttpError(429, { error: "rate", retryAfter, message: "Names can change once every 10 minutes." }, { "retry-after": String(retryAfter) });
    }
    const verdict = moderate.name(typeof body.name === "string" ? body.name : "");
    if (!verdict.ok) throw new HttpError(400, { error: "rejected", reason: verdict.reason, message: REASON_TEXT[verdict.reason] });
    const r = await store.claimName(ref, verdict.text, { isConnected: hub.isConnected, markChanged: true });
    if (r === "taken") throw new HttpError(409, { error: "taken", message: "Someone on the lines already has that name." });
    sendJson(res, 200, { name: verdict.text, line: LINES[lineFor(ref)], nextChangeInS: NAME_CHANGE_MS / 1000 });
  }

  async function postReport(req, res) {
    checkPost(req);
    const body = await readJson(req);
    const ref = clientRefOf(req);
    const t = reportCounter.take(ref);
    if (!t.ok) throw new HttpError(429, { error: "rate", retryAfter: seconds(t.retryAfterMs) });
    const m = await messageOr404(body.messageId);
    // Your own message, or one already off the air: accepted, and nothing happens.
    if (m.clientRef === ref || m.hidden) return sendJson(res, 200, { ok: true, hidden: m.hidden });
    const reporters = await store.addReport(m.id, ref);
    let hidden = false;
    if (reporters >= REPORTS_TO_HIDE) {
      if (await store.hideMessage(m.id, "reports")) {
        hub.broadcast("hide", { ids: [m.id] });
        await store.mute(m.clientRef, now() + REPORT_MUTE_MS, "reports");
      }
      hidden = true;
    }
    sendJson(res, 200, { ok: true, hidden });
  }

  async function admin(req, res, action) {
    checkPost(req);
    requireAdmin(req);
    const body = await readJson(req);
    switch (action) {
      case "hide": {
        const m = await messageOr404(body.messageId);
        await hide(m.id, "admin");
        return sendJson(res, 200, { ok: true });
      }
      case "mute": {
        const m = await messageOr404(body.messageId);
        const minutes = Math.min(Math.max(Number(body.minutes) || 10, 1), 7 * 24 * 60);
        await store.mute(m.clientRef, now() + minutes * 60_000, "admin");
        await hide(m.id, "admin");
        return sendJson(res, 200, { ok: true, minutes });
      }
      case "ban": {
        const m = await messageOr404(body.messageId);
        await store.ban(m.clientRef);
        bans.add(m.clientRef);
        const ids = await store.hideFrom(m.clientRef, 24 * 60 * 60_000, "admin");
        if (ids.length) hub.broadcast("hide", { ids });
        hub.closeRef(m.clientRef);
        return sendJson(res, 200, { ok: true, hidden: ids.length });
      }
      case "slow": {
        const on = body.on !== false;
        const minutes = Math.min(Math.max(Number(body.minutes) || 30, 1), 24 * 60);
        const until = on ? now() + minutes * 60_000 : null;
        await store.setForcedSlow(until);
        limits.setForced(until);
        announceSlowIfChanged();
        return sendJson(res, 200, { ok: true, slowMode: limits.slowMode() });
      }
      case "clear-name": {
        const m = await messageOr404(body.messageId);
        let name = null;
        for (let i = 0; i < 25 && !name; i++) {
          const candidate = randomCallerName();
          if ((await store.claimName(m.clientRef, candidate, { isConnected: hub.isConnected, markChanged: true })) === "ok") {
            name = candidate;
          }
        }
        if (!name) throw new HttpError(503, { error: "no-name-available" });
        const ids = await store.renameMessages(m.clientRef, name);
        if (ids.length) hub.broadcast("rename", { ids, name });
        return sendJson(res, 200, { ok: true, name });
      }
      case "verify": {
        // The deploy's POST round trip (scripts/deploy-live.sh): through nginx,
        // into Postgres as the service's role, read back, deleted. Written
        // already hidden, never broadcast: nobody on the lines sees it.
        const t0 = performance.now();
        const id = await store.verifyRoundTrip();
        return sendJson(res, 200, { ok: true, id, ms: Math.round(performance.now() - t0) });
      }
      default:
        throw new HttpError(404, { error: "not-found" });
    }
  }

  async function signin(req, res) {
    checkPost(req);
    const ref = clientRefOf(req);
    const t = signinCounter.take(ref);
    if (!t.ok) throw new HttpError(429, { error: "rate", retryAfter: seconds(t.retryAfterMs) });
    const body = await readJson(req);
    const nonce = typeof body.nonce === "string" ? body.nonce : "";
    if (!/^[0-9a-f]{64}$/.test(nonce) || !adminToken || !(await store.consumeNonce(sha256hex(nonce)))) {
      throw new HttpError(401, { error: "bad-link" });
    }
    log("[live] admin signed in with a one-time link");
    sendJson(res, 200, { ok: true }, { "set-cookie": sessionCookie(adminToken, now()) });
  }

  async function health(res) {
    sendJson(res, 200, {
      ok: true,
      clients: hub.size,
      messagesLastHour: await store.messagesSince(60 * 60_000),
      slowMode: limits.slowMode().on,
      cpu: cpu.average(),
      startedAt,
    });
  }

  async function route(req, res) {
    const url = new URL(req.url ?? "/", "http://live.local");
    const p = url.pathname;
    const m = req.method;
    await ready;
    if (m === "GET" && p === "/live-api/stream") return stream(req, res, url);
    if (m === "GET" && p === "/live-api/health") return health(res);
    if (m === "GET" && p === "/live-api/me") {
      const ref = clientRefOf(req);
      if (bans.has(ref)) return sendJson(res, 200, { banned: true, admin: false });
      const mute = await store.activeMute(ref);
      const wait = await store.renameWaitMs(ref);
      return sendJson(res, 200, {
        ...(await you(ref, req)),
        mutedUntil: mute ? new Date(mute.until).toISOString() : null,
        nextNameChangeInS: wait > 0 ? seconds(wait) : 0,
        slowMode: limits.slowMode(),
      });
    }
    if (m === "POST" && p === "/live-api/messages") return postMessage(req, res);
    if (m === "POST" && p === "/live-api/name") return postName(req, res);
    if (m === "POST" && p === "/live-api/report") return postReport(req, res);
    if (m === "POST" && p === "/live-api/admin/signin") return signin(req, res);
    if (m === "POST" && p === "/live-api/admin/signout") {
      checkPost(req);
      return sendJson(res, 200, { ok: true }, { "set-cookie": clearedCookie });
    }
    if (m === "GET" && p === "/live-api/admin/signin-page") {
      res.writeHead(200, SIGNIN_PAGE_HEADERS);
      return res.end(SIGNIN_PAGE);
    }
    const adminMatch = /^\/live-api\/admin\/(hide|mute|ban|slow|clear-name|verify)$/.exec(p);
    if (m === "POST" && adminMatch) return admin(req, res, adminMatch[1]);
    throw new HttpError(404, { error: "not-found" });
  }

  async function handle(req, res) {
    try {
      await route(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        if (!res.headersSent) sendJson(res, err.status, err.body, err.headers);
        else res.end();
        return;
      }
      log(`[live] ${req.method} ${req.url?.split("?")[0]} failed: ${err?.message ?? err}`);
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
      else res.end();
    }
  }

  return {
    handle,
    hub,
    limits,
    store,
    ready,
    sweep,
    clientRefOf,
    close() {
      clearInterval(retentionTimer);
      clearInterval(slowTimer);
      cpu.stop();
      hub.close();
    },
  };
}
