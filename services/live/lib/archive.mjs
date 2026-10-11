/**
 * Archive moments (2026-10-11): a line from the show's history, posted to the
 * phone lines when the room has gone quiet. Not a caller and never presented
 * as one: its own SSE event (`archive`), its own look in the UI, no name, no
 * line, nothing to reply to, report or rename. Nothing is stored, so it never
 * reaches live_messages, retention, reports or any count; the last few are
 * kept in memory for a new stream's hello, like tune-in notices.
 *
 * The rules, all of them required before one goes out:
 *   - someone has a stream open;
 *   - no caller has spoken for ARCHIVE_QUIET_MS (and none since the last one);
 *   - none has gone out for ARCHIVE_INTERVAL_MS.
 *
 * Tied to the broadcast: the moment is picked against the show on the air
 * (`onAir()`, the app's own /api/live/schedule over loopback), best first:
 *   1. a moment from that very episode;
 *   2. one whose tags appear in the show's title or guest;
 *   3. one from an episode that aired on today's date (Pacific);
 *   4. any other.
 * A moment used recently (the last ARCHIVE_NO_REPEAT) is not picked again
 * while another candidate in the same rank exists.
 *
 * The moments are archive-moments.json, beside this file (deploy-live.sh
 * copies lib/ whole). Each is `{id, text, tags, source, form?, speaker?, episode?}`;
 * `source` is the public page that supports it (`{title, url, supports}`);
 * `form: "quote"` is a speaker's own words and is drawn in quotation marks,
 * anything else is a description of a moment and never is.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { ARCHIVE_CHECK_MS, ARCHIVE_INTERVAL_MS, ARCHIVE_NO_REPEAT, ARCHIVE_ON_HELLO, ARCHIVE_QUIET_MS } from "./config.mjs";

export function loadMoments(file = path.join(import.meta.dirname, "archive-moments.json")) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The Pacific month-day of an instant, "MM-DD". */
export function pacificMonthDay(t) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "2-digit", day: "2-digit" }).formatToParts(t);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("month")}-${get("day")}`;
}

/**
 * The best moment for what is on the air, as `{moment, reason}`, or null when
 * there are none. `slot` is the schedule's slot (title, airDate, guestName) or null.
 */
export function pickMoment(moments, slot, { now = Date.now(), recent = [], random = Math.random } = {}) {
  if (!moments.length) return null;
  const hay = slot ? `${slot.title ?? ""} ${slot.guestName ?? ""}`.toLowerCase() : "";
  const today = pacificMonthDay(now);
  const rank = (m) => {
    if (slot && m.episode && m.episode.airDate === slot.airDate && m.episode.title === slot.title) return 0;
    if (hay && (m.tags ?? []).some((t) => t && hay.includes(t.toLowerCase()))) return 1;
    if (m.episode && m.episode.airDate.slice(5) === today) return 2;
    return 3;
  };
  const used = new Set(recent);
  for (const r of [0, 1, 2, 3]) {
    const pool = moments.filter((m) => rank(m) === r);
    if (!pool.length) continue;
    const fresh = pool.filter((m) => !used.has(m.id));
    // Ranks 0 to 2 are about tonight: a repeat there beats a stranger from rank 3.
    const from = fresh.length ? fresh : r < 3 ? pool : null;
    if (!from) continue;
    return { moment: from[Math.floor(random() * from.length)], reason: ["on-air", "topic", "this-date", "archive"][r] };
  }
  // Every moment used recently: the least recent one.
  const oldest = recent.find((id) => moments.some((m) => m.id === id));
  return { moment: moments.find((m) => m.id === oldest) ?? moments[0], reason: "archive" };
}

/** The line as the room receives it. */
export function archiveLine(moment, reason, now) {
  return {
    id: moment.id,
    at: new Date(now).toISOString(),
    text: moment.text,
    form: moment.form === "quote" ? "quote" : "moment",
    speaker: moment.form === "quote" ? moment.speaker ?? null : null,
    episode: moment.episode ? { airDate: moment.episode.airDate, title: moment.episode.title } : null,
    reason,
  };
}

/**
 * The scheduler. `broadcast(line)` sends it; `listeners()` is how many streams
 * are open; `onAir()` resolves the slot on the air (or null, never throws).
 */
export function createArchiveVoice({
  moments,
  broadcast,
  listeners,
  onAir,
  now = Date.now,
  random = Math.random,
  quietMs = ARCHIVE_QUIET_MS,
  intervalMs = ARCHIVE_INTERVAL_MS,
  checkMs = ARCHIVE_CHECK_MS,
  log = () => {},
}) {
  const startedAt = now();
  let lastCallAt = -Infinity;
  let lastPostAt = -Infinity;
  let busy = false;
  const recentIds = [];
  const recentLines = [];

  /** Whether the rules allow a line at this instant. */
  function due(t = now()) {
    if (listeners() < 1) return false;
    // A restart must not count as a quiet room: the quiet is measured from the
    // later of the last call and the start.
    if (t - Math.max(lastCallAt, startedAt) < quietMs) return false;
    return t - lastPostAt >= intervalMs;
  }

  async function tick() {
    if (busy || !due()) return null;
    busy = true;
    try {
      const slot = await onAir().catch(() => null);
      const t = now();
      if (!due(t)) return null; // a call arrived while the schedule was read
      const picked = pickMoment(moments, slot, { now: t, recent: recentIds, random });
      if (!picked) return null;
      const line = archiveLine(picked.moment, picked.reason, t);
      lastPostAt = t;
      recentIds.push(line.id);
      if (recentIds.length > ARCHIVE_NO_REPEAT) recentIds.shift();
      recentLines.push(line);
      if (recentLines.length > ARCHIVE_ON_HELLO) recentLines.shift();
      broadcast(line);
      log(`[live] archive: ${line.id} (${line.reason})`);
      return line;
    } finally {
      busy = false;
    }
  }

  const timer = checkMs > 0 ? setInterval(() => tick().catch(() => {}), checkMs) : null;
  timer?.unref?.();

  return {
    /** A caller spoke. */
    noteCall(t = now()) {
      lastCallAt = Math.max(lastCallAt, t);
    },
    due,
    tick,
    /** The last few lines, oldest first, for a new stream's hello. */
    recent: () => [...recentLines],
    close() {
      if (timer) clearInterval(timer);
    },
  };
}

/**
 * The show on the air, from the app's schedule over loopback. Null on any
 * failure, or in the station ID between shows.
 */
export function scheduleReader(url, { timeoutMs = 3_000, fetchImpl = fetch } = {}) {
  return async () => {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      const body = await res.json();
      return body?.now?.slot ?? null;
    } catch {
      return null;
    }
  };
}
