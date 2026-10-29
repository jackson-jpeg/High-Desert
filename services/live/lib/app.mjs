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

import { createArchiveVoice, loadMoments, scheduleReader } from "./archive.mjs";
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
  PLACE_CHANGE_MS,
  TUNEIN_BATCH_MS,
  TUNEIN_REPEAT_MS,
  TUNEIN_PLACES_SHOWN,
  TUNEIN_ON_HELLO,
  ARCHIVE_SCHEDULE_URL,
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
import { catalogReader, createRequestLine, MAX_NOTE_CHARS, NOMINATIONS_PER_ADDRESS_HOUR, RequestRefusal } from "./requests.mjs";

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
/** A query parameter as a positive integer, or null. */
const queryInt = (v) => (typeof v === "string" && /^[1-9][0-9]{0,15}$/.test(v) ? positiveInt(Number(v)) : null);
/** The console's stand-in caller for the Request Line state: matches no real caller. */
const NOBODY_REF = "0".repeat(64);
const seconds = (ms) => Math.max(1, Math.ceil(ms / 1000));
/** Station notices: how long hello carries them, how many, how long. */
export const STATION_KEEP_MS = 12 * 60 * 60_000;
export const STATION_ON_HELLO = 3;
export const STATION_MAX_CHARS = 500;

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
  /** Tests only: the tune-in notice batch window. */
  tuneinBatchMs = TUNEIN_BATCH_MS,
  heartbeatMs,
  log = (msg) => console.log(msg),
  /** Tests only: a private live_settings key, so parallel test apps do not share forced slow mode. */
  settingsKey,
  /**
   * Archive moments (lib/archive.mjs). `false` turns them off (tests); an
   * object overrides the moments, the schedule reader or the timing.
   */
  archive = {},
  /**
   * The Request Line (lib/requests.mjs). `false` turns it off; an object
   * overrides the catalog reader, the on-air reader or the herald's timing
   * (`heraldMs: false`: no timer, tests call `requests.herald()`).
   */
  requests = {},
}) {
  if (!clientSecret || clientSecret.length < 32) throw new Error("CHAT_CLIENT_SECRET must be set (32+ chars)");
  // A test app's settingsKey also scopes its station notices, so parallel test apps never see each other's.
  const store = createStore(pool, settingsKey ? { settingsKey, noticeScope: settingsKey } : {});
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
  const addressNominations = createWindowCounter({ max: NOMINATIONS_PER_ADDRESS_HOUR, windowMs: 60 * 60_000, now });
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
    await loadStation();
    await sweep();
  })();

  async function sweep() {
    spoken.clear();
    try {
      const n = await store.sweep();
      if (n > 0) log(`[live] retention: deleted ${n} message(s) older than 7 days`);
      await requestLine?.sweep();
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
    addressNominations.sweep();
    sweepTuneins();
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

  // ---- tune-in notices ---------------------------------------------------
  // "A listener just tuned in from Ohio." Batched: the first tune-in after a
  // quiet minute goes out at once, anything after it waits for the minute to
  // pass and goes out as one line. Nothing is stored; the last few are kept
  // in memory for a new stream's hello.

  /** caller ref → when they were last announced. */
  const tuneinSeen = new Map();
  let tuneinPending = null;
  let tuneinTimer = null;
  let tuneinLastAt = -Infinity;
  const tuneinRecent = [];
  // Station notices (2026-10-13): the site talking, posted by an admin
  // (POST /live-api/admin/notice). Drawn like an archive card under "From the
  // station", never as a caller. Kept for hello for STATION_KEEP_MS, the
  // newest STATION_ON_HELLO. In live_station_notices since 2026-10-29 (they
  // were memory only, and every deploy wiped them); `stationLines` is the
  // copy hello reads, loaded at start.
  const stationLines = [];
  const stationRecent = () => stationLines.filter((l) => now() - Date.parse(l.at) < STATION_KEEP_MS);
  const stationLine = ({ id, at, text, reason }) => ({ id, at, text, form: "moment", speaker: null, episode: null, reason });
  async function loadStation() {
    const rows = await store.stationNotices(now() - STATION_KEEP_MS, STATION_ON_HELLO);
    stationLines.splice(0, stationLines.length, ...rows.map(stationLine));
  }
  /** Post a station line: an admin's notice, or the Request Line's herald. Saved before it is sent. */
  async function postStation(text, reason = "station") {
    const t = now();
    const line = stationLine({ id: `station-${t}`, at: new Date(t).toISOString(), text, reason });
    await store.saveStationNotice(line, t - STATION_KEEP_MS, STATION_ON_HELLO);
    stationLines.push(line);
    if (stationLines.length > STATION_ON_HELLO) stationLines.shift();
    hub.broadcast("station", line);
    log(`[live] station notice ${line.id}`);
    return line;
  }

  function flushTuneins() {
    tuneinTimer = null;
    if (!tuneinPending) return;
    const notice = { at: new Date(now()).toISOString(), ...tuneinPending };
    tuneinPending = null;
    tuneinLastAt = now();
    tuneinRecent.push(notice);
    if (tuneinRecent.length > TUNEIN_ON_HELLO) tuneinRecent.shift();
    hub.broadcast("tunein", notice);
  }

  /** Returns whether this tune-in will be announced. */
  function noteTunein(ref, place) {
    const t = now();
    const last = tuneinSeen.get(ref);
    if (last !== undefined && t - last < TUNEIN_REPEAT_MS) return false;
    tuneinSeen.set(ref, t);
    tuneinPending ??= { count: 0, places: [] };
    tuneinPending.count += 1;
    if (place && tuneinPending.places.length < TUNEIN_PLACES_SHOWN && !tuneinPending.places.includes(place)) {
      tuneinPending.places.push(place);
    }
    if (!tuneinTimer) {
      tuneinTimer = setTimeout(flushTuneins, Math.max(0, tuneinLastAt + tuneinBatchMs - t));
      tuneinTimer.unref?.();
    }
    return true;
  }

  function sweepTuneins() {
    const t = now();
    for (const [ref, at] of tuneinSeen) if (t - at >= TUNEIN_REPEAT_MS) tuneinSeen.delete(ref);
  }

  // ---- archive moments ---------------------------------------------------
  // A line from the show's history when the room has gone quiet (archive.mjs).
  // Its own event, never a message: nothing stored, nothing counted.
  const voice =
    archive === false
      ? null
      : createArchiveVoice({
          moments: archive.moments ?? loadMoments(),
          onAir: archive.onAir ?? scheduleReader(archive.scheduleUrl ?? ARCHIVE_SCHEDULE_URL),
          broadcast: (line) => hub.broadcast("archive", line),
          listeners: () => hub.size,
          now,
          log,
          ...(archive.timing ?? {}),
        });

  // ---- the Request Line ----------------------------------------------------
  // Nominations and votes for the 10 PM slot (lib/requests.mjs). Its herald
  // says "Tonight's request, from ..." in the lines when the show comes on.
  const scheduleOnAir = archive && archive.onAir ? archive.onAir : scheduleReader(archive?.scheduleUrl ?? ARCHIVE_SCHEDULE_URL);
  const requestLine =
    requests === false
      ? null
      : createRequestLine({
          pool,
          now,
          catalog: requests.catalog ?? catalogReader(),
          onAir: requests.onAir ?? scheduleOnAir,
          announce: (text) => postStation(text, "request").catch((err) => log(`[live] herald notice not saved: ${err.message}`)),
          heraldMs: requests.heraldMs,
          log,
        });

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
    const { name, line, place } = await ensureCaller(caller);
    const firstCall = !(spoken.has(caller.ref) || (await store.hasSpoken(caller.ref)));
    return { name, line: LINES[line] ?? LINES[0], place, firstCall, admin: isAdminRequest(req, adminToken, now()) };
  }

  /**
   * The caller's name and line (index), assigning them on first contact: a
   * fresh unique name, and a line no other caller from the same address has.
   */
  async function ensureCaller({ ref, addr }) {
    const current = await store.getName(ref);
    const line = current?.line ?? (await store.assignLine(ref, addr, lineFor(ref)));
    const place = current?.place ?? null;
    if (current?.name) return { name: current.name, line, place };
    return { name: await freshName(ref, { markChanged: false }), line, place };
  }

  /**
   * Claim a random caller name for `ref`. The plain names ("Sleepless Night
   * Owl") number about six hundred, and every browser on the lines holds
   * one for half an hour, so a busy night fills them: after a few tries the
   * name gets a number ("Sleepless Night Owl 4821"), which is as good a name
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

  /** The caller an undo is about: `callerRef` (from the console's lists) or a message of theirs. */
  async function callerRefOr400(body) {
    if (typeof body.callerRef === "string" && /^[0-9a-f]{64}$/.test(body.callerRef)) return body.callerRef;
    if (body.messageId !== undefined) return (await messageOr404(body.messageId)).clientRef;
    throw new HttpError(400, { error: "bad-caller" });
  }

  /**
   * GET /live-api/admin/overview: what the admin console shows (sang3r.com).
   * Messages hidden ones and all, the running mutes, the bans, slow mode, the
   * station's recent notices and the service's health. `?limit=` (1..500,
   * default 200) and `?before=<id>` page the messages.
   */
  async function adminOverview(req, res, url) {
    requireAdmin(req);
    const limit = Math.min(queryInt(url.searchParams.get("limit")) ?? 200, 500);
    const before = queryInt(url.searchParams.get("before"));
    const [messages, mutes, bans, messagesLastHour] = await Promise.all([
      store.adminMessages(limit, before),
      store.activeMutes(),
      store.banList(),
      store.messagesSince(60 * 60_000),
    ]);
    sendJson(res, 200, {
      at: new Date(now()).toISOString(),
      messages,
      mutes,
      bans,
      slowMode: limits.slowMode(),
      notices: stationRecent(),
      health: {
        clients: hub.size,
        messagesLastHour,
        cpu: cpu.average(),
        startedAt,
        refusals: Object.fromEntries(refusals),
      },
    });
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
      {
        you: me,
        slowMode: limits.slowMode(),
        recent,
        resumed: !!lastId,
        hidden,
        tuneins: [...tuneinRecent],
        archive: voice?.recent() ?? [],
        station: stationRecent(),
      },
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
    const { name, line, place } = await ensureCaller(caller);
    const msg = await store.insertMessage({ clientRef: ref, addrRef: addr, name, place, line, body: verdict.text });
    spoken.add(ref);
    voice?.noteCall();
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

  /**
   * "Calling from". `{place}`: a new place, filtered like a name and limited
   * like one (PLACE_CHANGE_MS); empty or null clears it, always, at once.
   * Setting a place is not a call: it does not pass the first-call checks,
   * and nothing is said on the air until the caller's next message.
   */
  async function postPlace(req, res) {
    checkPost(req);
    const body = await readJson(req);
    const caller = await callerOf(req, res);
    const { ref } = caller;
    await assertMayPost(ref);
    const verdict = moderate.place(typeof body.place === "string" ? body.place : "");
    if (!verdict.ok) throw new HttpError(400, { error: "rejected", reason: verdict.reason, message: REASON_TEXT[verdict.reason] });
    await ensureCaller(caller);
    if (verdict.text !== null) {
      const current = await store.getName(ref);
      if (current?.place === verdict.text) return sendJson(res, 200, { place: verdict.text, nextChangeInS: seconds(await store.placeWaitMs(ref)) });
      const wait = await store.placeWaitMs(ref);
      if (wait > 0) {
        const retryAfter = seconds(wait);
        throw new HttpError(429, { error: "rate", retryAfter, message: "Where you're calling from can change once every 10 minutes." }, { "retry-after": String(retryAfter) });
      }
    }
    await store.setPlace(ref, verdict.text);
    sendJson(res, 200, { place: verdict.text, nextChangeInS: verdict.text === null ? seconds(await store.placeWaitMs(ref)) : PLACE_CHANGE_MS / 1000 });
  }

  /**
   * This browser just tuned in to the station. Announced to the room as a
   * quiet line (batched, and once an hour per caller at most), with the
   * caller's place if they have set one. `{announced}` says which.
   */
  async function postTuned(req, res) {
    checkPost(req);
    await readJson(req);
    const caller = await callerOf(req, res);
    if (bans.has(caller.ref)) return sendJson(res, 200, { announced: false });
    const current = await store.getName(caller.ref);
    sendJson(res, 200, { announced: noteTunein(caller.ref, current?.place ?? null) });
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
      case "unhide": {
        // Back in the record and in every hello from now on. Pages already
        // open dropped it on the hide and keep it dropped until they reload:
        // there is no event that puts a message back in place.
        const m = await messageOr404(body.messageId);
        return sendJson(res, 200, { ok: true, shown: await store.unhideMessage(m.id) });
      }
      case "unmute": {
        const ref = await callerRefOr400(body);
        return sendJson(res, 200, { ok: true, lifted: await store.unmute(ref) });
      }
      case "unban": {
        const ref = await callerRefOr400(body);
        const lifted = await store.unban(ref);
        bans.delete(ref);
        return sendJson(res, 200, { ok: true, lifted });
      }
      case "clear-name": {
        const m = await messageOr404(body.messageId);
        const name = await freshName(m.clientRef, { markChanged: true });
        if (!name) throw new HttpError(503, { error: "no-name-available" });
        // A name that needed clearing may have come with a place that does:
        // both go, on the caller and on what they said.
        await store.setPlace(m.clientRef, null);
        const ids = await store.renameMessages(m.clientRef, name);
        if (ids.length) hub.broadcast("rename", { ids, name, place: null });
        return sendJson(res, 200, { ok: true, name });
      }
      case "notice": {
        // Its own event, not "archive": a page from before this release
        // ignores it rather than heading it "From the archive".
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text || text.length > STATION_MAX_CHARS) throw new HttpError(400, { error: "bad-notice", max: STATION_MAX_CHARS });
        return sendJson(res, 201, await postStation(text));
      }
      case "request-veto": {
        if (!requestLine) throw new HttpError(404, { error: "not-found" });
        const id = positiveInt(body.nominationId);
        if (!id) throw new HttpError(400, { error: "bad-nomination" });
        return sendJson(res, 200, await requestLine.veto(id));
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

  // ---- Request Line routes ---------------------------------------------

  /** GET: today's nominations (tomorrow's after 6 PM), with this caller's own marks. */
  async function getRequests(req, res) {
    if (!requestLine) throw new HttpError(404, { error: "not-found" });
    const caller = await callerOf(req, res);
    const st = await requestLine.state(caller.ref);
    sendJson(res, 200, { ...st, admin: isAdminRequest(req, adminToken, now()) });
  }

  /**
   * GET /live-api/admin/requests: the same state as GET /live-api/requests,
   * for the admin console. No caller is made for it (the console has no
   * cookie, and a poll every few seconds would mint one each time), so the
   * per-caller marks (`mine`, `voted`, `nominated`) are always false.
   */
  async function adminRequests(req, res) {
    requireAdmin(req);
    if (!requestLine) throw new HttpError(404, { error: "not-found" });
    const st = await requestLine.state(NOBODY_REF);
    sendJson(res, 200, { ...st, admin: true });
  }

  /** POST {fileHash, note?}: nominate a show (or vote for it, if someone already has). */
  async function postNomination(req, res) {
    if (!requestLine) throw new HttpError(404, { error: "not-found" });
    checkPost(req);
    const body = await readJson(req);
    const caller = await callerOf(req, res);
    await assertMayPost(caller.ref);
    let note = null;
    if (typeof body.note === "string" && body.note.trim()) {
      const verdict = moderate.message(body.note);
      if (!verdict.ok) throw new HttpError(400, { error: "rejected", reason: verdict.reason, message: REASON_TEXT[verdict.reason] });
      if ([...verdict.text].length > MAX_NOTE_CHARS) {
        throw new HttpError(400, { error: "rejected", reason: "too-long", message: `Keep the note to ${MAX_NOTE_CHARS} characters.` });
      }
      note = verdict.text;
    }
    const t = addressNominations.take(caller.addr);
    if (!t.ok) {
      const retryAfter = seconds(t.retryAfterMs);
      throw new HttpError(429, { error: "rate", retryAfter }, { "retry-after": String(retryAfter) }, "address-nominations");
    }
    await admitFirstCall(caller);
    const who = await ensureCaller(caller);
    const r = await requestLine.nominate(caller, { fileHash: body.fileHash, note }, who);
    sendJson(res, r.joined ? 200 : 201, r);
  }

  /** POST {nominationId}: one vote per listener per show. */
  async function postVote(req, res) {
    if (!requestLine) throw new HttpError(404, { error: "not-found" });
    checkPost(req);
    const body = await readJson(req);
    const caller = await callerOf(req, res);
    if (bans.has(caller.ref)) throw new HttpError(403, { error: "banned", message: "This line has been disconnected." });
    const id = positiveInt(body.nominationId);
    if (!id) throw new HttpError(400, { error: "bad-nomination" });
    sendJson(res, 200, await requestLine.vote(caller, id));
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
      const placeWait = await store.placeWaitMs(ref);
      return sendJson(res, 200, {
        ...(await you(caller, req)),
        mutedUntil: mute ? new Date(mute.until).toISOString() : null,
        nextNameChangeInS: wait > 0 ? seconds(wait) : 0,
        nextPlaceChangeInS: placeWait > 0 ? seconds(placeWait) : 0,
        slowMode: limits.slowMode(),
      });
    }
    if (m === "POST" && p === "/live-api/messages") return postMessage(req, res);
    if (m === "POST" && p === "/live-api/name") return postName(req, res);
    if (m === "POST" && p === "/live-api/place") return postPlace(req, res);
    if (m === "POST" && p === "/live-api/tuned") return postTuned(req, res);
    if (m === "POST" && p === "/live-api/report") return postReport(req, res);
    if (m === "GET" && p === "/live-api/requests") return getRequests(req, res);
    if (m === "POST" && p === "/live-api/requests") return postNomination(req, res);
    if (m === "POST" && p === "/live-api/requests/vote") return postVote(req, res);
    if (m === "POST" && p === "/live-api/admin/signin") return signin(req, res);
    if (m === "POST" && p === "/live-api/admin/signout") {
      checkPost(req);
      return sendJson(res, 200, { ok: true }, { "set-cookie": clearedCookie });
    }
    if (m === "GET" && p === "/live-api/admin/signin-page") {
      res.writeHead(200, SIGNIN_PAGE_HEADERS);
      return res.end(SIGNIN_PAGE);
    }
    if (m === "GET" && p === "/live-api/admin/overview") return adminOverview(req, res, url);
    if (m === "GET" && p === "/live-api/admin/requests") return adminRequests(req, res);
    const adminMatch = /^\/live-api\/admin\/(hide|unhide|mute|unmute|ban|unban|slow|clear-name|verify|notice|request-veto)$/.exec(p);
    if (m === "POST" && adminMatch) return admin(req, res, adminMatch[1]);
    throw new HttpError(404, { error: "not-found" });
  }

  async function handle(req, res) {
    try {
      await route(req, res);
    } catch (caught) {
      // A Request Line refusal is an ordinary 4xx, counted like the rest.
      const err =
        caught instanceof RequestRefusal
          ? new HttpError(caught.status, { error: caught.error, message: caught.publicMessage, ...caught.extra })
          : caught;
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
    voice,
    requests: requestLine,
    ready,
    sweep,
    addrRefOf,
    refForCookie,
    close() {
      clearInterval(retentionTimer);
      clearInterval(slowTimer);
      clearTimeout(tuneinTimer);
      voice?.close();
      requestLine?.close();
      cpu.stop();
      hub.close();
    },
  };
}
