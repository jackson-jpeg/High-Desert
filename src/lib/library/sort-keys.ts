/**
 * Whose numbers each sort uses — one definition for the order, the group
 * headers and the column beside the rows.
 *
 * "Most played" used to sort by this browser's own `playCount`, group by that
 * too, and show the *community* count in the Plays column — three readings of
 * two sources. A listener saw a header "Played 2–4 times (2)" over a dozen rows
 * reading 41, 6, 78, 120, 27… in no order at all. Now:
 *
 *   - "Most played" and "Top rated" are the community's numbers, and say so.
 *   - "My plays" and "My rating" are this browser's, and say so.
 *   - `sortValue` is the key; the comparator orders by it, the rail buckets it,
 *     and `metricFor` puts that same number in the column.
 */

import type { Episode } from "@/db/schema";
import { communityKey } from "@/lib/utils/community-key";

export interface CommunityNumbers {
  plays: number;
  /** Mean community rating; 0 when unrated. */
  avg: number;
  /** Ratings behind `avg`. */
  count: number;
}

export type CommunityIndex = ReadonlyMap<string, CommunityNumbers>;

export const NO_COMMUNITY: CommunityIndex = new Map();

const ZERO: CommunityNumbers = { plays: 0, avg: 0, count: 0 };

export function communityOf(ep: Episode, community: CommunityIndex): CommunityNumbers {
  const key = communityKey(ep);
  return (key && community.get(key)) || ZERO;
}

/** The sorts whose order is a number, and whose number that is. */
export const NUMERIC_SORTS = {
  played: { whose: "community", label: "Most played", column: "Plays" },
  rated: { whose: "community", label: "Top rated", column: "Rating" },
  "my-plays": { whose: "mine", label: "My plays", column: "My plays" },
  "my-rating": { whose: "mine", label: "My rating", column: "My ★" },
} as const;

export type NumericSort = keyof typeof NUMERIC_SORTS;

export function isNumericSort(mode: string): mode is NumericSort {
  return Object.prototype.hasOwnProperty.call(NUMERIC_SORTS, mode);
}

/**
 * The number a numeric sort orders by, descending. For "rated" that is the
 * community average; ties go to the episode more people rated (see the
 * comparator), which is why `sortTiebreak` exists.
 */
export function sortValue(ep: Episode, mode: NumericSort, community: CommunityIndex): number {
  switch (mode) {
    case "played":
      return communityOf(ep, community).plays;
    case "rated":
      return communityOf(ep, community).avg;
    case "my-plays":
      return ep.playCount ?? 0;
    case "my-rating":
      return ep.rating ?? 0;
  }
}

/** Secondary key, also descending. Only "rated" has one: more ratings first. */
export function sortTiebreak(ep: Episode, mode: NumericSort, community: CommunityIndex): number {
  return mode === "rated" ? communityOf(ep, community).count : 0;
}

/**
 * The name a numeric sort goes by anywhere it is offered: community sorts say
 * "everyone", personal ones start with "My". Every menu reads this.
 */
export function sortLabel(mode: NumericSort): string {
  const s = NUMERIC_SORTS[mode];
  return s.whose === "community" ? `${s.label} · everyone` : s.label;
}

/** Tooltip for a numeric sort: whose numbers, in a sentence. */
export function sortDescription(mode: NumericSort): string {
  switch (mode) {
    case "played":
      return "Ordered by plays across all listeners";
    case "rated":
      return "Ordered by the community's average rating, then by how many rated it";
    case "my-plays":
      return "Ordered by how many times you have played each show";
    case "my-rating":
      return "Ordered by your own star ratings";
  }
}

/** Header over the metric column, for the sort in force. */
export function metricHeader(mode: string): string {
  return isNumericSort(mode) ? NUMERIC_SORTS[mode].column : "Plays";
}

export interface Metric {
  text: string;
  title?: string;
}

/**
 * What the metric column shows for `ep`. Under a numeric sort it is exactly
 * `sortValue` — the number the row was ordered by. Otherwise it is community
 * plays, as it always was.
 */
export function metricFor(ep: Episode, mode: string, community: CommunityIndex): Metric {
  const c = communityOf(ep, community);
  switch (mode) {
    case "rated":
      return c.count > 0
        ? { text: `★ ${c.avg.toFixed(1)}`, title: `Community average ${c.avg.toFixed(2)} from ${c.count} rating${c.count === 1 ? "" : "s"}` }
        : { text: "", title: "No community ratings yet" };
    case "my-plays": {
      const n = ep.playCount ?? 0;
      return n > 0 ? { text: `▶ ${n.toLocaleString()}`, title: `You have played this ${n} time${n === 1 ? "" : "s"}` } : { text: "" };
    }
    case "my-rating": {
      const r = ep.rating ?? 0;
      return r > 0 ? { text: `★ ${r}`, title: `You rated this ${r} star${r === 1 ? "" : "s"}` } : { text: "" };
    }
    default:
      return c.plays > 0
        ? { text: `▶ ${c.plays.toLocaleString()}`, title: `Played ${c.plays} times across all listeners` }
        : { text: "" };
  }
}
