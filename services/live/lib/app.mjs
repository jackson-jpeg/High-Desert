/**
 * highdesert-live: the phone lines. One plain node:http handler, no framework.
 *
 * Paths are served as nginx forwards them, prefix included (`location ^~
 * /live-api/ { proxy_pass http://127.0.0.1:3005; }` — no URI part, so nothing
 * is stripped). The full API, with shapes, is in docs/live-chat.md.
 *
 * Who is calling: one browser. `client_ref` is an HMAC of the random id in its
 * `hd_live_caller` cookie, which the service mints and signs (lib/caller.mjs).
 * Names, lines, the rename limit, reports, mutes and bans key on it, so a
 * household, or strangers behind a mobile carrier's NAT, are separate callers.
 *
 * Where from: `addr_ref` = HMAC of the app's own address bucket (IPv4 address,
 * IPv6 /64, lib/shared/client-key.ts), used only for generous per-address caps
 * and for holding an address after a ban. The address comes from
 * X-Forwarded-For, which nginx overwrites with $remote_addr, and is trusted only
 * from a loopback peer. It is used for that one hash and never stored, logged
 * or sent.
 */

import { randomInt } from "node:crypto";
import { hashClientKey } from "./shared/client-key.ts";
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
  STREAMS_PER_CALLER,
  CALLER_COOKIE,
  NEW_CALLERS_PER_ADDRESS_HOUR,
  FIRST_CALLS_PER_ADDRESS_HOUR,
  MESSAGES_PER_ADDRESS_MINUTE,
  REPORTS_PER_ADDRESS_MINUTE,
  STREAMS_PER_ADDRESS,
  BAN_HOLD_MS,
  BAN_HOLD_INTERVAL_MS,
  LEGACY_ADOPT_MS,
} from "./config.mjs";
import { createStore } from "./store.mjs";
import { createHub } from "./sse.mjs";
import { createLimits, createWindowCounter } from "./limits.mjs";
import { createModerator, REASON_TEXT } from "./moderation/index.mjs";
import { dedupKey } from "./moderation/normalize.mjs";
import { lineFor, LINES, numberedCallerName, randomCallerName } from "./names.mjs";
import { clearedCookie, isAdminRequest, parseCookies, sessionCookie, sha256hex } from "./admin.mjs";
import { addressRef, callerCookie, callerRef, mintCallerId, verifyCallerCookie } from "./caller.mjs";
import { SIGNIN_PAGE, SIGNIN_PAGE_HEADERS } from "./signin-page.mjs";
import { createCpuSampler } from "./cpu.mjs";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const DEFAULT_ORIGINS = ["https://highdesert.space", "https://www.highdesert.space"];

class HttpError extends Error {
  /**
   * @param {string} [kind] what the refusal counts as in /live-api/health's
   *   `refusals` when `body.error` alone cannot tell (an address cap answers
   *   with the same "rate" a caller's own pace does). Never sent to the client.
   */
  constructor(status, body, headers = {}, kind) {
    super(body?.error ?? String(status));
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.kind = kind;
  }
}

/** Refusals that are about the ADDRESS, not the person: the ones a NAT can hit. */
export const ADDRESS_REFUSALS = ["busy-network", "address-hold", "address-limit", "address-messages", "address-reports", "address-streams"];

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  // A caller cookie minted for this request (res.setHeader) and a route's own
  // cookie (the admin session) must both reach the browser.
  if (headers["set-cookie"] && res.getHeader("set-cookie")) {
    headers = { ...headers, "set-cookie": [].concat(res.getHeader("set-cookie"), headers["set-cookie"]) };
  }
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
 * @param {boolean} [o.secureCookies] mark the caller cookie Secure (default; off only for a plain-http local stack)
 */
export function createLiveApp({
  pool,
  clientSecret,
  adminToken,
  origins = DEFAULT_ORIGINS,
  blocklist,
  loadTest = false,
  secureCookies = true,
  now = Date.now,
  /** Tests only: where random caller names come from. */
  randomName = randomCallerName,
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
  // Per-address caps: secondary, and generous (config.mjs).
  const mintCounter = createWindowCounter({ max: NEW_CALLERS_PER_ADDRESS_HOUR, windowMs: 60 * 60_000, now });
  const firstCallCounter = createWindowCounter({ max: FIRST_CALLS_PER_ADDRESS_HOUR, windowMs: 60 * 60_000, now });
  const addressMessages = createWindowCounter({ max: MESSAGES_PER_ADDRESS_MINUTE, windowMs: 60_000, now });
  const addressReports = createWindowCounter({ max: REPORTS_PER_ADDRESS_MINUTE, windowMs: 60_000, now });
  /** addr_ref → open streams, across every caller behind it. */
  const addressStreams = new Map();
  /** Callers known to have talked: they skip the first-call checks. Cleared hourly. */
  const spoken = new Set();
  const cpu = createCpuSampler();
  const bans = new Set();
  const startedAt = new Date(now()).toISOString();

  const ready = (async () => {
    for (const ref of await store.allBans()) bans.add(ref);
    limits.setForced(await store.getForcedSlow());
    await sweep();
  })();

  async function sweep() {
    spoken.clear();
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
    mintCounter.sweep();
    firstCallCounter.sweep();
    addressMessages.sweep();
    addressReports.sweep();
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

  function loadTestKey(req) {
    const peer = req.socket.remoteAddress ?? "";
    const key = req.headers["x-live-test-client"];
    return loadTest && LOOPBACK.has(peer) && typeof key === "string" ? key.slice(0, 64) : null;
  }

  /** Where a request is from, as an HMAC: the secondary abuse key. */
  function addrRefOf(req) {
    const load = loadTestKey(req);
    if (load !== null) return hashClientKey(`load-addr:${load}`, clientSecret);
    return addressRef(clientAddress(req), clientSecret);
  }

  /**
   * Who is calling: the caller in the request's cookie, or a new one.
   *
   * A request with no valid cookie is a new browser. It gets a fresh id (as a
   * Set-Cookie on whatever this response turns out to be), within the
   * per-address mint cap. The first new browser from an address that had a
   * caller before per-browser ids takes that caller over, name and all.
   *
   * @returns {Promise<{ ref: string, addr: string }>}
   */
  async function callerOf(req, res) {
    const addr = addrRefOf(req);
    const load = loadTestKey(req);
    if (load !== null) return { ref: hashClientKey(`load:${load}`, clientSecret), addr };
    // One browser, one caller: the ref comes from the cookie's id, never the address.
    const refFor = (id) => callerRef(id, clientSecret);
    const id = verifyCallerCookie(parseCookies(req.headers.cookie)[CALLER_COOKIE], clientSecret);
    if (id) return { ref: refFor(id), addr };
    const t = mintCounter.take(addr);
    if (!t.ok) {
      const retryAfter = seconds(t.retryAfterMs);
      throw new HttpError(
        429,
        { error: "busy-network", retryAfter, message: "Too many new callers from your network right now. Try again soon." },
        { "retry-after": String(retryAfter) },
      );
    }
    const fresh = mintCallerId();
    const ref = refFor(fresh);
    res.setHeader("set-cookie", callerCookie(clientSecret, fresh, { secure: secureCookies }));
    const adopted = await store.adoptLegacy(addr, ref, LEGACY_ADOPT_MS);
    if (adopted?.banned) bans.add(ref);
    return { ref, addr };
  }

  /** Tests: the caller ref behind a cookie value (never used to serve requests). */
  function refForCookie(value) {
    const id = verifyCallerCookie(value, clientSecret);
    return id ? callerRef(id, clientSecret) : null;
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

  async function you(caller, req) {
    const { name, line } = await ensureCaller(caller);
    return { name, line: LINES[line] ?? LINES[0], admin: isAdminRequest(req, adminToken, now()) };
  }

  /**
   * The caller's name and line (index), assigning them on first contact: a
   * fresh unique name, and a line no other caller from the same address has.
   */
  async function ensureCaller({ ref, addr }) {
    const current = await store.getName(ref);
    const line = current?.line ?? (await store.assignLine(ref, addr, lineFor(ref)));
    if (current?.name) return { name: current.name, line };
    return { name: await freshName(ref, { markChanged: false }), line };
  }

  /**
   * Claim a random caller name for `ref`. The plain names ("Night Owl in
   * Pahrump") number about a thousand, and every browser on the lines holds
   * one for half an hour, so a busy night fills them: after a few tries the
   * name gets a number ("Night Owl in Pahrump 4821"), which is as good a name
   * and costs no more round trips. Null only if every try was taken.
   */
  async function freshName(ref, { markChanged }) {
    for (let i = 0; i < 16; i++) {
      const name = i < 4 ? randomName() : numberedCallerName(randomInt, randomName, (n) => moderate.name(n).ok);
      if ((await store.claimName(ref, name, { isConnected: hub.isConnected, markChanged })) === "ok") return name;
    }
    return null;
  }

  /**
   * A caller's first call or first rename. Once someone has talked, this is a
   * no-op. A new caller counts against their address: a generous hourly cap,
   * and, while the address is held after a ban, one new caller per interval.
   * Callers already talking from a held address are untouched.
   */
  async function admitFirstCall({ ref, addr }) {
    if (spoken.has(ref) || (await store.hasSpoken(ref))) {
      spoken.add(ref);
      return;
    }
    const held = await store.takeHoldSlot(addr, BAN_HOLD_INTERVAL_MS);
    if (!held.ok) {
      const retryAfter = seconds(held.retryAfterMs);
      throw new HttpError(
        429,
        { error: "address-hold", retryAfter, message: "New callers from your network are on hold for a while. Try again later." },
        { "retry-after": String(retryAfter) },
      );
    }
    const t = firstCallCounter.take(addr);
    if (!t.ok) {
      const retryAfter = seconds(t.retryAfterMs);
      throw new HttpError(
        429,
        { error: "address-limit", retryAfter, message: "Lots of new callers from your network. Try again in a little while." },
        { "retry-after": String(retryAfter) },
      );
    }
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
    const caller = await callerOf(req, res);
    const { ref, addr } = caller;
    if (bans.has(ref)) throw new HttpError(403, { error: "banned" });
    const streamCap =
      hub.streamsOf(ref) >= STREAMS_PER_CALLER ? "caller-streams"
      : (addressStreams.get(addr) ?? 0) >= STREAMS_PER_ADDRESS ? "address-streams"
      : hub.size >= MAX_STREAMS ? "all-streams"
      : null;
    if (streamCap) throw new HttpError(429, { error: "too-many-streams" }, { "retry-after": "30" }, streamCap);
    const lastIdRaw = req.headers["last-event-id"] ?? url.searchParams.get("lastEventId");
    const lastId = positiveInt(Number(lastIdRaw));
    await store.touch(ref, addr);
    const [me, recent, hidden] = await Promise.all([
      you(caller, req),
      lastId ? store.visibleAfter(lastId, 200) : store.recentVisible(RECENT_ON_HELLO),
      store.recentlyHidden(HIDDEN_REPLAY_MS),
    ]);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: ${RETRY_HINT_MS}\n\n`);
    addressStreams.set(addr, (addressStreams.get(addr) ?? 0) + 1);
    const client = hub.add(res, ref, () => {
      const n = (addressStreams.get(addr) ?? 1) - 1;
      if (n > 0) addressStreams.set(addr, n);
      else addressStreams.delete(addr);
      store.touch(ref, addr).catch(() => {});
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
    const caller = await callerOf(req, res);
    const { ref, addr } = caller;
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
    await admitFirstCall(caller);
    const busy = addressMessages.take(addr);
    if (!busy.ok) {
      const retryAfter = seconds(busy.retryAfterMs);
      throw new HttpError(429, { error: "rate", retryAfter, slowMode: limits.slowMode().on }, { "retry-after": String(retryAfter) }, "address-messages");
    }
    const { name, line } = await ensureCaller(caller);
    const msg = await store.insertMessage({ clientRef: ref, addrRef: addr, name, line, body: verdict.text });
    spoken.add(ref);
    const turnedSlow = limits.record(ref, key);
    hub.broadcast("message", msg, msg.id);
    if (turnedSlow) announceSlowIfChanged();
    sendJson(res, 201, msg);
  }

  async function postName(req, res) {
    checkPost(req);
    const body = await readJson(req);
    const caller = await callerOf(req, res);
    const { ref } = caller;
    await assertMayPost(ref);
    const wait = await store.renameWaitMs(ref);
    if (wait > 0) {
      const retryAfter = seconds(wait);
      throw new HttpError(429, { error: "rate", retryAfter, message: "Names can change once every 10 minutes." }, { "retry-after": String(retryAfter) });
    }
    const verdict = moderate.name(typeof body.name === "string" ? body.name : "");
    if (!verdict.ok) throw new HttpError(400, { error: "rejected", reason: verdict.reason, message: REASON_TEXT[verdict.reason] });
    await admitFirstCall(caller);
    const { line } = await ensureCaller(caller);
    const r = await store.claimName(ref, verdict.text, { isConnected: hub.isConnected, markChanged: true });
    if (r === "taken") throw new HttpError(409, { error: "taken", message: "Someone on the lines already has that name." });
    spoken.add(ref);
    sendJson(res, 200, { name: verdict.text, line: LINES[line] ?? LINES[0], nextChangeInS: NAME_CHANGE_MS / 1000 });
  }

  async function postReport(req, res) {
    checkPost(req);
    const body = await readJson(req);
    const { ref, addr } = await callerOf(req, res);
    const t = reportCounter.take(ref);
    if (!t.ok) throw new HttpError(429, { error: "rate", retryAfter: seconds(t.retryAfterMs) });
    const ta = addressReports.take(addr);
    if (!ta.ok) throw new HttpError(429, { error: "rate", retryAfter: seconds(ta.retryAfterMs) }, {}, "address-reports");
    const m = await messageOr404(body.messageId);
    // Your own message, or one already off the air: accepted, and nothing happens.
    if (m.clientRef === ref || m.hidden) return sendJson(res, 200, { ok: true, hidden: m.hidden });
    const reporters = await store.addReport(m.id, ref, addr);
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
        // Clearing cookies is not a free reset: the address is held, so new
        // callers from it start talking at most once an hour for a day.
        await store.holdAddress(m.addrRef, now() + BAN_HOLD_MS, now() + BAN_HOLD_INTERVAL_MS);
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
        const name = await freshName(m.clientRef, { markChanged: true });
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
    const t = signinCounter.take(addrRefOf(req));
    if (!t.ok) throw new HttpError(429, { error: "rate", retryAfter: seconds(t.retryAfterMs) });
    const body = await readJson(req);
    const nonce = typeof body.nonce === "string" ? body.nonce : "";
    if (!/^[0-9a-f]{64}$/.test(nonce) || !adminToken || !(await store.consumeNonce(sha256hex(nonce)))) {
      throw new HttpError(401, { error: "bad-link" });
    }
    log("[live] admin signed in with a one-time link");
    sendJson(res, 200, { ok: true }, { "set-cookie": sessionCookie(adminToken, now()) });
  }

  // Refusals since start, by kind, for the launch watch and highdesert-status:
  // `refusals` counts every 4xx a caller route answered, `refusedAddresses`
  // how many distinct addresses met each address cap. A person's own pace and
  // an address cap both answer "rate" to the client; only these tell them apart.
  const refusals = new Map();
  const refusedAddresses = new Map();
  function countRefusal(err, req) {
    if (err.status < 400 || err.status >= 500 || err.status === 404) return;
    const kind = err.kind ?? (err.body?.reason ? `${err.body.error}:${err.body.reason}` : String(err.body?.error ?? err.status));
    refusals.set(kind, (refusals.get(kind) ?? 0) + 1);
    if (ADDRESS_REFUSALS.includes(kind)) {
      const set = refusedAddresses.get(kind) ?? new Set();
      if (set.size < 10_000) set.add(addrRefOf(req));
      refusedAddresses.set(kind, set);
    }
  }

  async function health(res) {
    sendJson(res, 200, {
      ok: true,
      clients: hub.size,
      messagesLastHour: await store.messagesSince(60 * 60_000),
      slowMode: limits.slowMode().on,
      cpu: cpu.average(),
      startedAt,
      refusals: Object.fromEntries(refusals),
      refusedAddresses: Object.fromEntries([...refusedAddresses].map(([k, v]) => [k, v.size])),
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
      const caller = await callerOf(req, res);
      const { ref } = caller;
      if (bans.has(ref)) return sendJson(res, 200, { banned: true, admin: false });
      const mute = await store.activeMute(ref);
      const wait = await store.renameWaitMs(ref);
      return sendJson(res, 200, {
        ...(await you(caller, req)),
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
        countRefusal(err, req);
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
    addrRefOf,
    refForCookie,
    close() {
      clearInterval(retentionTimer);
      clearInterval(slowTimer);
      cpu.stop();
      hub.close();
    },
  };
}
