/**
 * The station's program — pure, deterministic, and shared by the server (which
 * generates and freezes each day) and the browser (which works out what is on
 * at any instant from the published day).
 *
 * ## The day
 *
 * The station day runs midnight to midnight **Pacific** (America/Los_Angeles),
 * so it is 23 hours on the spring-forward date and 25 on the fall-back one —
 * `pacificDayBounds()` measures it rather than assuming 24.
 *
 * Program, in order:
 *
 *   1. **On this date** — every catalog episode whose air date has today's month
 *      and day, any year, oldest first. On 28 February of a non-leap year the
 *      29 February broadcasts join them, or they would never air.
 *   2. **Fan favorites** — the rest of the catalog by community plays, most
 *      first, skipping anything already on today, anything that aired on the
 *      station in the previous `REPEAT_WINDOW_DAYS` days, and anything whose
 *      own date comes up in the next `REPEAT_WINDOW_DAYS` days (it is held for
 *      that date: a favorite on 27 October was on again as 28 October's
 *      broadcast, 2026-10-28). A favorite sharing a guest with a show already
 *      on today, or on in the previous `GUEST_GAP_DAYS` days, waits behind the
 *      ones that do not (Richard C. Hoagland has 67 shows). A holiday show
 *      (Ghost to Ghost, Christmas, New Year's: `showSeason`) is a favorite
 *      only in its own season (src/lib/season/season.ts); a Christmas Eve
 *      show was about to air on Halloween.
 *
 * Slots are laid end to end from midnight with a `STATION_ID_SEC` gap between
 * them (the station ID). Slots are added while the next one would *start*
 * before midnight, so the day always fills; the last one usually runs over.
 *
 * **10 PM is the Request Line's** (2026-10-14, docs/request-line.md). Before
 * it, a show that would run past 10 PM gives way to the next one in order
 * that fits (on-this-date first, then favorites); only when nothing fits is
 * the last one cut, one station ID before 10 PM. At 10 PM sits a stand-in, a
 * fan favorite marked `requestSlot`, and the day carries on after it. The
 * listeners' winner, locked at 6 PM, replaces the stand-in at read time
 * (`applyRequest`) and everything after it moves to make room.
 * **The next day's first slot starts at midnight regardless, and the overrun is
 * cut** — the slot's `end` is clipped to the day's end. A day whose on-this-date
 * list alone runs past midnight simply never reaches its fan favorites.
 *
 * Episodes with no (or zero) catalog duration are skipped — there is no way to
 * place the next slot after them — as are the pulled episodes
 * (`src/lib/library/removed-episodes.ts`).
 *
 * Every ordering has a total tie-break on `fileHash`, so the same inputs always
 * give the same day, byte for byte.
 *
 * ## Frozen, not recomputed
 *
 * Community plays move all the time, so a day computed at 09:00 and again at
 * 21:00 would differ. The server therefore generates a day once and freezes it
 * (`live_days`, src/services/live/days.ts); `buildDays()` below takes the frozen
 * days as given and only ever builds the ones that are missing.
 *
 * ## Outage swap
 *
 * Applied at read time, never frozen: `applyOutageSwap()`.
 */

import { communityKey } from "@/lib/utils/community-key";
import { REMOVED_FROM_CATALOG } from "@/lib/library/removed-episodes";
import { episodeTitle } from "@/lib/library/display-title";
import { seasonOfDay, showSeason } from "@/lib/season/season";
import { STATION_TZ, addDays, pacificDayBounds, parts, requestStartAt } from "./pacific";

/** The gap between shows, filled by the station ID. Part of the timeline math. */
export const STATION_ID_SEC = 8;
/**
 * A fan favorite that aired in this many previous days is skipped, and one
 * whose own date is this many days ahead or fewer is held for it. 14 until
 * 2026-10-29 (listeners heard the same shows on back-to-back days); 30 is
 * the Request Line's "played recently" too.
 */
export const REPEAT_WINDOW_DAYS = 30;
/** A favorite whose guest was on in this many previous days (or today) waits. */
export const GUEST_GAP_DAYS = 2;
/**
 * How much of the fan-favorite ranking a frozen day keeps, for the outage swap.
 * The mirror pins the most-played shows, so the top of this list is where its
 * substitutes come from; the tail would only bloat the stored day.
 */
export const RANKING_KEEP = 200;
/**
 * Before 10 PM, once nothing in the catalog fits the time left, a gap shorter
 * than this is left to the station ID; a longer one gets the next show, cut
 * one station ID before 10 PM. The catalog's short shows (a few minutes) make
 * a gap this size rare; cutting a three-hour show to air its first minutes
 * would cost that show its airing for a moment's sound.
 */
export const MIN_CUT_MS = 10 * 60_000;

/**
 * `verify-swap`: the scheduled file failed its frame walk before the day was
 * frozen (`applyVerifySwap`). `breaker-swap`: listeners failed on the show
 * while it aired, and the rest of its slot went to another (`applyOverrides`).
 */
export type SlotKind = "on-this-date" | "fan-favorite" | "outage-swap" | "verify-swap" | "breaker-swap" | "request";

/** Who asked for a `request` slot: the nominator, as they called in, and the night's tally. */
export interface SlotRequest {
  by: string;
  place: string | null;
  votes: number;
  /** The Pacific day it was the request for. */
  day: string;
}

/** The catalog fields the schedule reads (a `public/seed/library.json` row). */
export interface CatalogRow {
  fileHash: string;
  fileName: string;
  archiveIdentifier?: string | null;
  title?: string | null;
  airDate?: string | null;
  guestName?: string | null;
  showType?: string | null;
  duration?: number | null;
  sourceUrl?: string | null;
}

export interface ProgramSlot {
  fileHash: string;
  /** Community key — what the stats routes and the allowlist speak. */
  episodeId: string | null;
  title: string;
  airDate: string | null;
  guestName: string | null;
  showType: string | null;
  /** The episode's catalog duration, seconds. */
  duration: number;
  sourceUrl: string | null;
  kind: SlotKind;
  /** Epoch ms. */
  start: number;
  /**
   * Epoch ms when this slot stops airing: start + duration, clipped at the
   * day's end (the overrun rule) — and, for an outage swap, at the original
   * slot's end. The station ID fills from here to the next slot's `start`.
   */
  end: number;
  /** For a swap of any kind: the fileHash this slot was scheduled with. */
  replaces?: string;
  /** The show that starts on the hour at 10 PM, before any request (days frozen from 2026-10-14). */
  requestSlot?: true;
  /** A `request` slot's nominator and tally. */
  request?: SlotRequest;
}

export interface DayProgram {
  /** Pacific yyyy-mm-dd. */
  day: string;
  /** Epoch ms of the day's first and last instant (midnight to midnight Pacific). */
  start: number;
  end: number;
  slots: ProgramSlot[];
  /** Fan favorites by community plays when this day was frozen (fileHashes, top RANKING_KEEP). */
  ranking: string[];
}

export interface BuildInputs {
  catalog: readonly CatalogRow[];
  /** Community plays by community key — a snapshot. Missing = 0. */
  plays: ReadonlyMap<string, number>;
}

// ---------------------------------------------------------------------------
// Pacific calendar: src/lib/live/pacific.ts (shared with the phone lines'
// service, which imports it under Node's type stripping), re-exported here.
// ---------------------------------------------------------------------------

export {
  STATION_TZ,
  isDayISO,
  addDays,
  pacificMidnight,
  pacificDayBounds,
  pacificDay,
  REQUEST_HOUR,
  REQUEST_CLOSE_HOUR,
  requestStartAt,
  requestCloseAt,
  requestDayAt,
} from "./pacific";

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Month-day keys whose broadcasts air on `day`. */
export function onThisDateKeys(day: string): string[] {
  const [y, m, d] = parts(day);
  const md = day.slice(5);
  // 29 February broadcasts would otherwise air only one year in four.
  if (m === 2 && d === 28 && !isLeapYear(y)) return [md, "02-29"];
  return [md];
}

// ---------------------------------------------------------------------------
// Building a day
// ---------------------------------------------------------------------------

function durationMs(row: Pick<CatalogRow, "duration">): number {
  return Math.round((row.duration ?? 0) * 1000);
}

/** Can this row go on the air at all? */
export function isAirable(row: CatalogRow): boolean {
  return (
    !!row.fileHash &&
    typeof row.duration === "number" &&
    Number.isFinite(row.duration) &&
    row.duration > 0 &&
    !REMOVED_FROM_CATALOG.has(row.fileHash)
  );
}

function byHash(a: CatalogRow, b: CatalogRow): number {
  return a.fileHash < b.fileHash ? -1 : a.fileHash > b.fileHash ? 1 : 0;
}

/** The catalog by community plays, most first; ties by fileHash. Airable rows only. */
export function rankByPlays(inputs: BuildInputs): CatalogRow[] {
  const playsOf = (r: CatalogRow) => inputs.plays.get(communityKey(r) ?? "") ?? 0;
  return inputs.catalog
    .filter(isAirable)
    .map((r) => ({ r, p: playsOf(r) }))
    .sort((a, b) => b.p - a.p || byHash(a.r, b.r))
    .map((x) => x.r);
}

export function toSlot(row: CatalogRow, kind: SlotKind, start: number, end: number): ProgramSlot {
  return {
    fileHash: row.fileHash,
    episodeId: communityKey({ archiveIdentifier: row.archiveIdentifier, fileName: row.fileName }),
    title: episodeTitle(row),
    airDate: row.airDate ?? null,
    guestName: row.guestName ?? null,
    showType: row.showType ?? null,
    duration: row.duration ?? 0,
    sourceUrl: row.sourceUrl ?? null,
    kind,
    start,
    end,
  };
}

/**
 * The people in a guest field, for spacing them out: "Richard C. Hoagland &
 * Seth Shostak" is two. Lower case, trimmed; an empty field is nobody.
 */
export function guestsOf(field: string | null | undefined): string[] {
  if (!field) return [];
  return field
    .split(/\s*(?:&|,|;|\band\b)\s*/i)
    .map((g) => g.trim().toLowerCase())
    .filter((g) => g.length > 2);
}

/**
 * One day's program.
 *
 * `history` is the programs of earlier days; only those within
 * REPEAT_WINDOW_DAYS before `day` are read (GUEST_GAP_DAYS for guests). Pure: same arguments, same day.
 */
export function buildDay(day: string, inputs: BuildInputs, history: readonly DayProgram[]): DayProgram {
  const { start: dayStart, end: dayEnd } = pacificDayBounds(day);
  const earliest = addDays(day, -REPEAT_WINDOW_DAYS);
  const aired = new Set<string>();
  for (const h of history) {
    if (h.day >= earliest && h.day < day) for (const s of h.slots) aired.add(s.fileHash);
  }

  const recentGuests = new Set<string>();
  const guestFrom = addDays(day, -GUEST_GAP_DAYS);
  for (const h of history) {
    if (h.day >= guestFrom && h.day < day) for (const s of h.slots) for (const g of guestsOf(s.guestName)) recentGuests.add(g);
  }
  // Month-days coming up in the window: their broadcasts are held for them.
  const comingUp = new Set<string>();
  for (let i = 1; i <= REPEAT_WINDOW_DAYS; i++) for (const md of onThisDateKeys(addDays(day, i))) comingUp.add(md);

  const airable = inputs.catalog.filter(isAirable);
  const mds = new Set(onThisDateKeys(day));
  const onThisDate = airable
    .filter((r) => !!r.airDate && mds.has(r.airDate.slice(5, 10)))
    .sort((a, b) => (a.airDate! < b.airDate! ? -1 : a.airDate! > b.airDate! ? 1 : byHash(a, b)));
  const today = new Set(onThisDate.map((r) => r.fileHash));

  const ranking = rankByPlays(inputs);
  const season = seasonOfDay(day);
  const inSeason = (r: CatalogRow) => {
    const own = showSeason(r.title);
    return own === null || own === season;
  };
  const favorites = ranking.filter(
    (r) =>
      !today.has(r.fileHash) &&
      !aired.has(r.fileHash) &&
      !(r.airDate && comingUp.has(r.airDate.slice(5, 10))) &&
      inSeason(r),
  );

  const slots: ProgramSlot[] = [];
  const gap = STATION_ID_SEC * 1000;
  const requestStart = requestStartAt(day);
  let t = dayStart;
  const place = (row: CatalogRow, kind: SlotKind, clipAt = dayEnd) => {
    const end = Math.min(t + durationMs(row), clipAt, dayEnd);
    slots.push(toSlot(row, kind, t, end));
    today.add(row.fileHash);
    for (const g of guestsOf(row.guestName)) recentGuests.add(g);
    t = t + durationMs(row) + gap;
  };

  // One queue, in the order the day wants them: on this date, then favorites.
  const queue: { row: CatalogRow; kind: SlotKind }[] = [
    ...onThisDate.map((row) => ({ row, kind: "on-this-date" as const })),
    ...favorites.map((row) => ({ row, kind: "fan-favorite" as const })),
  ];
  // Only reachable with a catalog too small to fill a day without repeats (or a
  // test that makes one): relax the repeat rule rather than leave dead air,
  // most-played first, and cycle if even that runs out.
  let relaxed: CatalogRow[] | null = null;
  let relaxedAt = 0;
  // A favorite whose guest was just on waits for one whose guest was not;
  // with none left, the queue's order stands.
  const fresh = (q: { row: CatalogRow; kind: SlotKind }) =>
    q.kind !== "fan-favorite" || !guestsOf(q.row.guestName).some((g) => recentGuests.has(g));
  const next = (fits?: (row: CatalogRow) => boolean): { row: CatalogRow; kind: SlotKind } | null => {
    const ok = (q: { row: CatalogRow }) => !fits || fits(q.row);
    let i = queue.findIndex((q) => ok(q) && fresh(q));
    if (i < 0) i = queue.findIndex(ok);
    if (i >= 0) return queue.splice(i, 1)[0];
    if (queue.length || ranking.length === 0) return null;
    if (!relaxed) {
      const rest = ranking.filter((r) => !today.has(r.fileHash));
      relaxed = rest.length > 0 ? rest : ranking;
    }
    if (fits) {
      const row = relaxed.find(fits);
      return row ? { row, kind: "fan-favorite" } : null;
    }
    return { row: relaxed[relaxedAt++ % relaxed.length], kind: "fan-favorite" };
  };

  // Up to 10 PM: the next show if it ends (and its station ID) by then, else
  // the next one in order that does; only when none does, cut one at 10 PM.
  while (t < requestStart) {
    const room = requestStart - t;
    const fits = (r: CatalogRow) => durationMs(r) + gap <= room;
    const pick = next(fits);
    if (pick) {
      place(pick.row, pick.kind);
      continue;
    }
    if (room >= MIN_CUT_MS) {
      const cut = next();
      if (cut) place(cut.row, cut.kind, requestStart - gap);
    }
    break;
  }

  // 10 PM: the next show in the usual order starts on the hour, marked as the
  // request slot's (an empty night plays it, as the day always would), then
  // the rest of the night.
  t = requestStart;
  const onTheHour = next();
  if (onTheHour && t < dayEnd) {
    place(onTheHour.row, onTheHour.kind);
    slots[slots.length - 1].requestSlot = true;
  }
  while (t < dayEnd) {
    const pick = next();
    if (!pick) break;
    place(pick.row, pick.kind);
  }

  return {
    day,
    start: dayStart,
    end: dayEnd,
    slots,
    ranking: ranking.slice(0, RANKING_KEEP).map((r) => r.fileHash),
  };
}

/**
 * Build every day the target needs that is not already frozen.
 *
 * The repeat rule makes a day depend on the fourteen before it, and each of
 * those on the fourteen before *it*. Rather than recurse without bound, the
 * window is fixed: days `target − REPEAT_WINDOW_DAYS … target`, in order. A
 * frozen day is taken as given; a missing one is built from the frozen days and
 * the ones built earlier in this same pass. Anything before the window that is
 * not frozen counts as "nothing aired" — which only happens the first time the
 * station runs, and is deterministic either way.
 *
 * Returns the days it built, oldest first; the caller freezes all of them, so
 * the next call finds them frozen and the history never shifts under a day.
 */
export function buildDays(
  target: string,
  inputs: BuildInputs,
  frozen: ReadonlyMap<string, DayProgram>,
): DayProgram[] {
  const known = new Map(frozen);
  const built: DayProgram[] = [];
  for (let i = REPEAT_WINDOW_DAYS; i >= 0; i--) {
    const d = addDays(target, -i);
    if (known.has(d)) continue;
    const history: DayProgram[] = [];
    for (let j = 1; j <= REPEAT_WINDOW_DAYS; j++) {
      const h = known.get(addDays(d, -j));
      if (h) history.push(h);
    }
    const program = buildDay(d, inputs, history);
    known.set(d, program);
    built.push(program);
  }
  return built;
}

// ---------------------------------------------------------------------------
// Outage swap (read time)
// ---------------------------------------------------------------------------

export interface ManifestSet {
  version: string;
  fileHashes: ReadonlySet<string>;
}

/**
 * archive.org is down: replace every slot the mirror cannot play ("unpinned")
 * with one it can, by the frozen day's fan-favorite ranking.
 *
 * - **Slot times never move.** Everyone tuned in must still agree what is on
 *   at a given second, and the day after must still start at midnight.
 * - A substitute at least as long as the slot is preferred; it is cut at the
 *   slot's end. When none is left, the longest remaining is used and ends
 *   early — the station ID fills the rest of the slot.
 * - Substitutes come from `ranking ∩ manifest`, then the rest of the manifest
 *   by fileHash; never a show that is already on today from the mirror, and
 *   never the same substitute twice until the supply runs out.
 * - Deterministic: same day + same manifest → same swap, on every server and
 *   every request. Slots the mirror holds are returned untouched.
 */
export function applyOutageSwap(
  program: DayProgram,
  manifest: ManifestSet,
  catalogByHash: ReadonlyMap<string, CatalogRow>,
): DayProgram {
  const playable = (h: string) => manifest.fileHashes.has(h);
  if (program.slots.every((s) => playable(s.fileHash))) return program;

  const inRanking = new Set(program.ranking);
  const rest = [...manifest.fileHashes].filter((h) => !inRanking.has(h)).sort();
  const candidates = [...program.ranking.filter(playable), ...rest]
    .map((h) => catalogByHash.get(h))
    .filter((r): r is CatalogRow => !!r && isAirable(r));
  return swapSlots(program, playable, candidates, "outage-swap");
}

/**
 * Replace every slot `keep` refuses with the first of `candidates` not
 * already on the day, preferring one at least as long as the slot. **Slot
 * times never move**: a shorter substitute ends early and the station ID fills
 * the rest; a longer one is cut at the slot's end. With no candidates the
 * program is returned as it was.
 */
export function swapSlots(
  program: DayProgram,
  keep: (fileHash: string) => boolean,
  candidates: readonly CatalogRow[],
  kind: SlotKind,
): DayProgram {
  if (program.slots.every((s) => keep(s.fileHash))) return program;
  if (candidates.length === 0) return program;

  const used = new Set(program.slots.filter((s) => keep(s.fileHash)).map((s) => s.fileHash));
  const slots = program.slots.map((slot) => {
    if (keep(slot.fileHash)) return slot;
    // The slot's length is to the next slot's start minus the gap — i.e. what
    // the scheduled show would have had. `end` may already be clipped at midnight.
    const length = slot.end - slot.start;
    let pool = candidates.filter((c) => !used.has(c.fileHash));
    if (pool.length === 0) {
      used.clear();
      pool = [...candidates];
    }
    const pick =
      pool.find((c) => durationMs(c) >= length) ??
      pool.reduce((best, c) => (durationMs(c) > durationMs(best) ? c : best), pool[0]);
    used.add(pick.fileHash);
    return {
      ...toSlot(pick, kind, slot.start, Math.min(slot.end, slot.start + durationMs(pick))),
      replaces: slot.fileHash,
    };
  });
  return { ...program, slots };
}

/**
 * What the pre-air check knows of each file (Postgres `audio_checks`, written
 * by scripts/verify-live-day.mjs from a full frame walk).
 */
export interface AudioChecks {
  /** Walked and failed: never to air. */
  bad: ReadonlySet<string>;
  /** Walked and passed: safe to put on in a bad one's place. */
  ok: ReadonlySet<string>;
}

/**
 * The station never airs a file known to be broken (2026-10-11). Every slot
 * whose file failed its walk is replaced by a fan favorite that passed one,
 * pinned on the mirror first (`pinned`, when the manifest is known), in the
 * frozen ranking's order. Slot times stay where they were (`swapSlots`).
 */
export function applyVerifySwap(
  program: DayProgram,
  checks: AudioChecks,
  catalogByHash: ReadonlyMap<string, CatalogRow>,
  pinned: ReadonlySet<string> | null,
): DayProgram {
  const keep = (h: string) => !checks.bad.has(h);
  if (program.slots.every((s) => keep(s.fileHash))) return program;
  const verified = program.ranking.filter((h) => checks.ok.has(h) && !checks.bad.has(h));
  const ordered = pinned ? [...verified.filter((h) => pinned.has(h)), ...verified.filter((h) => !pinned.has(h))] : verified;
  const candidates = ordered.map((h) => catalogByHash.get(h)).filter((r): r is CatalogRow => !!r && isAirable(r));
  return swapSlots(program, keep, candidates, "verify-swap");
}

/**
 * A trip of the station's circuit breaker (Postgres `live_overrides`,
 * src/services/live/breaker.ts): from `cutAt` the slot that started at
 * `slotStart` with `fileHash` is off the air, and after one station ID
 * `replacement` plays to the slot's original end (or nothing does, when
 * `replacement` is null and no verified show was available).
 */
export interface LiveOverride {
  slotStart: number;
  fileHash: string;
  cutAt: number;
  replacement: string | null;
}

/**
 * The slots with every override applied: the tripped slot ends at `cutAt`,
 * and the replacement starts one station ID later and ends where the tripped
 * slot would have. Nothing else moves. An override naming a slot that is not
 * there (another day, an outage swap since) changes nothing.
 */
export function applyOverrides(
  slots: readonly ProgramSlot[],
  overrides: readonly LiveOverride[],
  catalogByHash: ReadonlyMap<string, CatalogRow>,
): ProgramSlot[] {
  if (!overrides.length) return [...slots];
  const out: ProgramSlot[] = [];
  for (const slot of slots) {
    const o = overrides.find((x) => x.slotStart === slot.start && x.fileHash === slot.fileHash);
    if (!o || o.cutAt >= slot.end) {
      out.push(slot);
      continue;
    }
    const cutAt = Math.max(slot.start, o.cutAt);
    out.push({ ...slot, end: cutAt });
    const row = o.replacement ? catalogByHash.get(o.replacement) : undefined;
    const start = cutAt + STATION_ID_SEC * 1000;
    if (row && isAirable(row) && start < slot.end) {
      out.push({ ...toSlot(row, "breaker-swap", start, Math.min(slot.end, start + durationMs(row))), replaces: slot.fileHash });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The Request Line (read time)
// ---------------------------------------------------------------------------

/**
 * A night's locked request (Postgres `live_request_nights`, locked at 6 PM
 * Pacific by `live_request_night()`, services/live/schema.sql). `fileHash`
 * null: nobody nominated, and the stand-in fan favorite plays as frozen.
 */
export interface RequestNight {
  day: string;
  fileHash: string | null;
  by: string | null;
  place: string | null;
  votes: number;
}

/**
 * The day with its listeners' request at 10 PM Pacific.
 *
 * - Everything before 10 PM is untouched (a day frozen before the Request
 *   Line, with no show on the hour, has the one running at 10 PM cut one
 *   station ID before it).
 * - The winner starts at exactly 10 PM.
 * - **The rest of the night shifts**: every show from 10 PM on keeps its
 *   order and plays one after another from the winner's end, the last cut at
 *   midnight as ever (what no longer starts before midnight drops off); if
 *   the night has room left, the frozen ranking fills it. A show already on
 *   the day is never put on twice.
 * - Deterministic in the day and the night, like every other read-time
 *   change; the lock happens four hours before 10 PM, and a tuned-in tab
 *   follows a changed slot within a minute (`followChanges`).
 */
export function applyRequest(
  program: DayProgram,
  night: RequestNight | null,
  catalogByHash: ReadonlyMap<string, CatalogRow>,
): DayProgram {
  if (!night || night.day !== program.day || !night.fileHash) return program;
  const row = catalogByHash.get(night.fileHash);
  if (!row || !isAirable(row)) return program;
  const gap = STATION_ID_SEC * 1000;
  const at = requestStartAt(program.day);
  const dayEnd = program.end;

  const slots: ProgramSlot[] = [];
  const after: ProgramSlot[] = [];
  for (const s of program.slots) {
    if (s.start < at) {
      const end = Math.min(s.end, at - gap);
      if (end > s.start) slots.push(end === s.end ? s : { ...s, end });
    } else {
      const { requestSlot: _onTheHour, ...moved } = s;
      after.push(moved);
    }
  }
  const onDay = new Set(slots.map((s) => s.fileHash));
  onDay.add(row.fileHash);
  slots.push({
    ...toSlot(row, "request", at, Math.min(at + durationMs(row), dayEnd)),
    request: { by: night.by ?? "a listener", place: night.place, votes: night.votes, day: night.day },
  });
  let t = at + durationMs(row) + gap;
  for (const s of after) {
    if (t >= dayEnd) break;
    if (onDay.has(s.fileHash)) continue;
    const length = Math.round(s.duration * 1000);
    slots.push({ ...s, start: t, end: Math.min(t + length, dayEnd) });
    onDay.add(s.fileHash);
    t += length + gap;
  }
  for (const h of program.ranking) {
    if (t >= dayEnd) break;
    const r = catalogByHash.get(h);
    if (!r || onDay.has(h) || !isAirable(r)) continue;
    slots.push(toSlot(r, "fan-favorite", t, Math.min(t + durationMs(r), dayEnd)));
    onDay.add(h);
    t += durationMs(r) + gap;
  }
  return { ...program, slots };
}

// ---------------------------------------------------------------------------
// What is on
// ---------------------------------------------------------------------------

export type OnNow =
  | { slot: ProgramSlot; startedAt: number; offsetSec: number; endsAt: number }
  | { stationId: true; endsAt: number };

/**
 * What is on the air at `at` (epoch ms, server time), given a run of slots in
 * time order — normally one day's, plus the next day's when it is known.
 *
 * Between a slot's `end` and the next slot's `start` is the station ID. With no
 * next slot known, the station ID runs to `fallbackEnd` (the day's end).
 */
export function locate(slots: readonly ProgramSlot[], at: number, fallbackEnd: number): OnNow {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (at < s.start) return { stationId: true, endsAt: s.start };
    if (at < s.end) return { slot: s, startedAt: s.start, offsetSec: (at - s.start) / 1000, endsAt: s.end };
  }
  return { stationId: true, endsAt: Math.max(fallbackEnd, at) };
}

/** `GET /api/live/schedule` — see the route for the documented shape. */
export interface LiveSchedule {
  day: string;
  tz: typeof STATION_TZ;
  /** Epoch ms on the server when the answer was computed. */
  serverNow: number;
  stationIdSec: number;
  now: OnNow;
  upNext: ProgramSlot[];
  /** The rest of today's program after `upNext`. */
  rest: ProgramSlot[];
  /** The whole of today's program, past slots included — the program guide. */
  guide: ProgramSlot[];
  /** archive.org is down; `outage-swap` slots are what the mirror can play. */
  outage: boolean;
}

/**
 * Every slot a schedule knows, in time order, once each: today's guide plus
 * whatever of tomorrow `upNext` reaches into. What a client locates against.
 */
export function knownSlots(s: Pick<LiveSchedule, "guide" | "upNext">): ProgramSlot[] {
  const byStart = new Map<number, ProgramSlot>();
  for (const slot of [...s.guide, ...s.upNext]) byStart.set(slot.start, slot);
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}

/** The slots that start after `at`, in order. */
export function upcoming(slots: readonly ProgramSlot[], at: number): ProgramSlot[] {
  return slots.filter((s) => s.start > at);
}
