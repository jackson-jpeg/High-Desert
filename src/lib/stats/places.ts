/**
 * The arithmetic and words behind the Listeners panel (docs/visitors.md):
 * where a state sits on the tile map, how dark its tile is, and how a place
 * is named. Pure, so the panel's numbers are tested without the panel.
 */

/** A tile map of the United States: [postal code, column, row], 11 × 8. */
export const US_TILES: readonly (readonly [string, number, number])[] = [
  ["AK", 0, 0], ["ME", 10, 0],
  ["VT", 9, 1], ["NH", 10, 1],
  ["WA", 0, 2], ["ID", 1, 2], ["MT", 2, 2], ["ND", 3, 2], ["MN", 4, 2], ["IL", 5, 2], ["WI", 6, 2],
  ["MI", 7, 2], ["NY", 8, 2], ["RI", 9, 2], ["MA", 10, 2],
  ["OR", 0, 3], ["NV", 1, 3], ["WY", 2, 3], ["SD", 3, 3], ["IA", 4, 3], ["IN", 5, 3], ["OH", 6, 3],
  ["PA", 7, 3], ["NJ", 8, 3], ["CT", 9, 3],
  ["CA", 0, 4], ["UT", 1, 4], ["CO", 2, 4], ["NE", 3, 4], ["MO", 4, 4], ["KY", 5, 4], ["WV", 6, 4],
  ["VA", 7, 4], ["MD", 8, 4], ["DE", 9, 4],
  ["AZ", 1, 5], ["NM", 2, 5], ["KS", 3, 5], ["AR", 4, 5], ["TN", 5, 5], ["NC", 6, 5], ["SC", 7, 5], ["DC", 8, 5],
  ["OK", 3, 6], ["LA", 4, 6], ["MS", 5, 6], ["AL", 6, 6], ["GA", 7, 6],
  ["HI", 0, 7], ["TX", 3, 7], ["FL", 8, 7],
];
export const US_TILE_COLS = 11;
export const US_TILE_ROWS = 8;

/**
 * How dark a tile is: 0 for nobody, else 1–4 by its share of the busiest
 * state, on a square-root scale so one big state does not leave the rest of
 * the map blank.
 */
export function tileTier(n: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0 || max <= 0) return 0;
  const r = Math.sqrt(Math.min(n, max) / max);
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

/** The fill per tier, as a share of amber over the well (no hex: var() only). */
export const TIER_FILL = ["0%", "22%", "42%", "66%", "100%"] as const;

/** Counts by postal code, from the API's states (unknown and non-states dropped). */
export function countsByCode(states: { code: string | null; n: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of states) if (s.code) m.set(s.code, (m.get(s.code) ?? 0) + s.n);
  return m;
}

/** The known places, largest first, and how many were not placed. */
export function splitKnown<T extends { n: number }>(rows: T[], key: (r: T) => string | null): { known: T[]; unknown: number } {
  const known: T[] = [];
  let unknown = 0;
  for (const r of rows) {
    if (key(r) === null) unknown += r.n;
    else known.push(r);
  }
  known.sort((a, b) => b.n - a.n);
  return { known, unknown };
}

/** "Nevada", "Ontario, Canada", "Canada", "Pahrump, Nevada". Null when there is no country at all. */
export function placeLabel(p: { country: string | null; name?: string | null; region: string | null; city?: string | null }): string | null {
  if (!p.country) return null;
  const country = p.name ?? p.country;
  const where = p.country === "US" ? (p.region ?? country) : p.region ? `${p.region}, ${country}` : country;
  return p.city && p.region ? `${p.city}, ${p.country === "US" ? p.region : where}` : where;
}

/** Below this share placed, a period says how much of it is on the map. */
export const PLACED_NOTE_BELOW = 0.9;
/** A period is where the panel opens once this share of it is placed. */
export const DEFAULT_PERIOD_PLACED = 0.25;

interface Placed {
  total: number;
  countries: { country: string | null; n: number }[];
}

/** How many of a period's listeners have a place: its total less the unknown-country bucket. */
export function placedCount(b: Placed): number {
  const unknown = b.countries.reduce((sum, c) => (c.country === null ? sum + c.n : sum), 0);
  return Math.max(0, b.total - unknown);
}

const placedShare = (b: Placed) => (b.total > 0 ? placedCount(b) / b.total : 0);

/**
 * "1 of 1,206 placed so far. ...", while under PLACED_NOTE_BELOW of the period
 * is placed; null once the map is mostly filled, and for an empty period.
 * The backfilled funnel arrivals have no place until that browser comes back.
 */
export function placedNote(b: Placed): string | null {
  const placed = placedCount(b);
  if (b.total <= 0 || placed >= b.total * PLACED_NOTE_BELOW) return null;
  const fmt = (v: number) => v.toLocaleString("en-US");
  return `${fmt(placed)} of ${fmt(b.total)} placed so far. The map fills in as listeners come back.`;
}

/**
 * Where the panel opens: All time once a quarter of it is placed, else This
 * week if a quarter of that is, else Right now (heartbeats are always placed).
 */
export function defaultPeriod(locations: { allTime: Placed; week: Placed }): "allTime" | "week" | "now" {
  if (placedShare(locations.allTime) >= DEFAULT_PERIOD_PLACED) return "allTime";
  if (placedShare(locations.week) >= DEFAULT_PERIOD_PLACED) return "week";
  return "now";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-27" → "27 Sep 2026" (the date as written, no time zone moves it). */
export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "just now", "4 min ago", "2 h ago", "3 d ago". */
export function agoLabel(at: string, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(at)) / 1000));
  if (!Number.isFinite(s) || s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}
