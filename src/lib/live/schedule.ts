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
 *      first, skipping anything already on today and anything that aired on the
 *      station in the previous `REPEAT_WINDOW_DAYS` days.
 *
 * Slots are laid end to end from midnight with a `STATION_ID_SEC` gap between
 * them (the station ID). Slots are added while the next one would *start*
 * before midnight, so the day always fills; the last one usually runs over.
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

export const STATION_TZ = "America/Los_Angeles";
/** The gap between shows, filled by the station ID. Part of the timeline math. */
export const STATION_ID_SEC = 8;
/** A fan favorite that aired in this many previous days is skipped. */
export const REPEAT_WINDOW_DAYS = 14;
/**
 * How much of the fan-favorite ranking a frozen day keeps, for the outage swap.
 * The mirror pins the most-played shows, so the top of this list is where its
 * substitutes come from; the tail would only bloat the stored day.
 */
export const RANKING_KEEP = 200;

export type SlotKind = "on-this-date" | "fan-favorite" | "outage-swap";

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
  /** For an outage swap: the fileHash this slot was scheduled with. */
  replaces?: string;
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
// Pacific calendar
// ---------------------------------------------------------------------------

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayISO(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function parts(day: string): [number, number, number] {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`not a yyyy-mm-dd day: ${day}`);
  return [+m[1], +m[2], +m[3]];
}

/** `day` plus `n` calendar days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

let dtf: Intl.DateTimeFormat | null = null;
function formatter(): Intl.DateTimeFormat {
  dtf ??= new Intl.DateTimeFormat("en-US", {
    timeZone: STATION_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return dtf;
}

function wallClock(ms: number): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const out: Record<string, number> = {};
  for (const p of formatter().formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, mo: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second };
}

/** Pacific wall-clock minus UTC at `ms`, in ms (−7 h or −8 h). */
function pacificOffsetMs(ms: number): number {
  const w = wallClock(ms);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of 00:00 Pacific on `day`. Midnight is never inside a DST gap here. */
export function pacificMidnight(day: string): number {
  const [y, m, d] = parts(day);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - pacificOffsetMs(guess);
  // Once more from the corrected instant: the offset at UTC midnight can be the
  // other side of a transition from the offset at Pacific midnight.
  t = guess - pacificOffsetMs(t);
  return t;
}

/** The station day as [start, end) epoch ms. 23 h, 24 h or 25 h long. */
export function pacificDayBounds(day: string): { start: number; end: number } {
  return { start: pacificMidnight(day), end: pacificMidnight(addDays(day, 1)) };
}

/** The Pacific calendar day an instant falls in. */
export function pacificDay(ms: number): string {
  const w = wallClock(ms);
  return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

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
    title: row.title || row.fileName,
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
 * One day's program.
 *
 * `history` is the programs of earlier days; only those within
 * REPEAT_WINDOW_DAYS before `day` are read. Pure: same arguments, same day.
 */
export function buildDay(day: string, inputs: BuildInputs, history: readonly DayProgram[]): DayProgram {
  const { start: dayStart, end: dayEnd } = pacificDayBounds(day);
  const earliest = addDays(day, -REPEAT_WINDOW_DAYS);
  const aired = new Set<string>();
  for (const h of history) {
    if (h.day >= earliest && h.day < day) for (const s of h.slots) aired.add(s.fileHash);
  }

  const airable = inputs.catalog.filter(isAirable);
  const mds = new Set(onThisDateKeys(day));
  const onThisDate = airable
    .filter((r) => !!r.airDate && mds.has(r.airDate.slice(5, 10)))
    .sort((a, b) => (a.airDate! < b.airDate! ? -1 : a.airDate! > b.airDate! ? 1 : byHash(a, b)));
  const today = new Set(onThisDate.map((r) => r.fileHash));

  const ranking = rankByPlays(inputs);
  const favorites = ranking.filter((r) => !today.has(r.fileHash) && !aired.has(r.fileHash));

  const slots: ProgramSlot[] = [];
  const gap = STATION_ID_SEC * 1000;
  let t = dayStart;
  const place = (row: CatalogRow, kind: SlotKind) => {
    const end = Math.min(t + durationMs(row), dayEnd);
    slots.push(toSlot(row, kind, t, end));
    today.add(row.fileHash);
    t = t + durationMs(row) + gap;
  };

  for (const row of onThisDate) {
    if (t >= dayEnd) break;
    place(row, "on-this-date");
  }
  for (const row of favorites) {
    if (t >= dayEnd) break;
    place(row, "fan-favorite");
  }
  // Only reachable with a catalog too small to fill a day without repeats (or a
  // test that makes one): relax the repeat rule rather than leave dead air,
  // most-played first, and cycle if even that runs out.
  if (t < dayEnd && ranking.length > 0) {
    const relaxed = ranking.filter((r) => !today.has(r.fileHash));
    const pool = relaxed.length > 0 ? relaxed : ranking;
    for (let i = 0; t < dayEnd; i++) place(pool[i % pool.length], "fan-favorite");
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
  if (candidates.length === 0) return program;

  const used = new Set(program.slots.filter((s) => playable(s.fileHash)).map((s) => s.fileHash));
  const slots = program.slots.map((slot) => {
    if (playable(slot.fileHash)) return slot;
    // The slot's length is to the next slot's start minus the gap — i.e. what
    // the scheduled show would have had. `end` may already be clipped at midnight.
    const length = slot.end - slot.start;
    let pool = candidates.filter((c) => !used.has(c.fileHash));
    if (pool.length === 0) {
      used.clear();
      pool = candidates;
    }
    const pick =
      pool.find((c) => durationMs(c) >= length) ??
      pool.reduce((best, c) => (durationMs(c) > durationMs(best) ? c : best), pool[0]);
    used.add(pick.fileHash);
    return {
      ...toSlot(pick, "outage-swap", slot.start, Math.min(slot.end, slot.start + durationMs(pick))),
      replaces: slot.fileHash,
    };
  });
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
