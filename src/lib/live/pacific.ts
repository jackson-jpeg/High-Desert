/**
 * The station's Pacific calendar: days, midnights and the Request Line's two
 * daily instants. Shared by the app (src/lib/live/schedule.ts re-exports it)
 * and by the phone lines' service (services/live/lib/shared/pacific.ts is a
 * symlink here, imported under Node's native type stripping), so this file
 * must not use `@/` imports or non-erasable TS (enums, parameter properties,
 * namespaces), like src/lib/utils/client-key.ts.
 *
 * The station day runs midnight to midnight Pacific: 23 h on the
 * spring-forward date, 25 on the fall-back one. DST changes at 2 AM, so 6 PM
 * and 10 PM are always 6 h and 2 h before the next midnight.
 */

export const STATION_TZ = "America/Los_Angeles";

/**
 * The Request Line (2026-10-14, docs/request-line.md): the listeners' pick
 * airs at 10 PM Pacific, Art Bell's original airtime, and voting for that
 * night closes at 6 PM.
 */
export const REQUEST_HOUR = 22;
export const REQUEST_CLOSE_HOUR = 18;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayISO(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function parts(day: string): [number, number, number] {
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


/** Epoch ms of 10 PM Pacific on `day`: the request slot's start. */
export function requestStartAt(day: string): number {
  return pacificDayBounds(day).end - (24 - REQUEST_HOUR) * 3_600_000;
}

/** Epoch ms of 6 PM Pacific on `day`: voting for that night closes. */
export function requestCloseAt(day: string): number {
  return pacificDayBounds(day).end - (24 - REQUEST_CLOSE_HOUR) * 3_600_000;
}

/**
 * The night a nomination or vote made at `ms` is for: today until 6 PM
 * Pacific, tomorrow from then on.
 */
export function requestDayAt(ms: number): string {
  const today = pacificDay(ms);
  return ms < requestCloseAt(today) ? today : addDays(today, 1);
}
