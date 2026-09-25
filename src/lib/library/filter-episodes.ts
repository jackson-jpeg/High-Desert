/**
 * The library's list pipeline: which episodes are shown, and in what order.
 *
 * Pure — no React, no Dexie. It was a 155-line `useMemo` inside
 * `library/page.tsx` (HD-018), which made every criterion untestable except by
 * mounting the whole page. Moved verbatim; the behaviour is the page's.
 *
 * The input is expected in Dexie's `airDate` descending order, because the
 * "date" sort does not sort at all — it keeps that order. Every sort here is
 * `Array.prototype.sort`, which is stable, so ties keep their input order too.
 *
 * `selectLibraryEpisodes()` is the one value the list renders. Anything that
 * has to agree with the rows on screen — a year rail, keyboard navigation,
 * shift-click ranges, scroll-to-current — must derive from that same array,
 * not re-run the pipeline or read `allEpisodes`.
 */

import type { Episode } from "@/db/schema";
import { NO_PROGRESS, type ProgressIndex } from "@/stores/progress-store";
import { parseSearch, type ComparisonOp } from "@/lib/utils/search-parser";
import {
  NO_COMMUNITY,
  isNumericSort,
  sortTiebreak,
  sortValue,
  type CommunityIndex,
} from "@/lib/library/sort-keys";

/**
 * "date" is newest first (Dexie's order, kept as is); "date-asc" is oldest
 * first. There was no ascending date sort until the rail was made to follow
 * the list (docs/timeline-rail.md) — the only oldest-first listing was a
 * series filter.
 *
 * "played" and "rated" are the community's numbers; "my-plays" and "my-rating"
 * are this browser's. `src/lib/library/sort-keys.ts` is where that is decided,
 * once, for the order, the group headers and the column.
 */
export type SortMode =
  | "date" | "date-asc" | "name" | "guest" | "recent" | "progress"
  | "rated" | "played" | "my-plays" | "my-rating";
export type ShowFilter = "all" | "coast" | "dreamland" | "special" | "unknown";

export const SORT_MODES: readonly SortMode[] = [
  "date", "date-asc", "name", "guest", "recent", "progress", "rated", "played", "my-plays", "my-rating",
];

export interface LibraryCriteria {
  /** Raw search box text, operators included (see `parseSearch`). */
  search: string;
  showFilter: ShowFilter;
  favoritesOnly: boolean;
  guestFilter: string | null;
  categoryFilter: string | null;
  seriesFilter: string | null;
  /** Episode ids with at least one bookmark, for `has:bookmark`. Undefined while loading. */
  bookmarkedIds?: ReadonlySet<number>;
  /**
   * "Playable now", during an archive.org outage: the mirror's manifest. A
   * catalog episode must be in it; anything else (a local file) never needed
   * archive.org and stays. Null or absent: no such filter.
   */
  playableOnly?: ReadonlySet<string> | null;
}

export function matchComparison(actual: number, op: ComparisonOp["op"], target: number): boolean {
  switch (op) {
    case ">": return actual > target;
    case ">=": return actual >= target;
    case "<": return actual < target;
    case "<=": return actual <= target;
    case "=": return actual === target;
  }
}

/**
 * Narrow `episodes` to those matching every criterion. Order is preserved.
 * With no criteria set it returns the input array itself.
 */
export function filterEpisodes(episodes: Episode[], criteria: LibraryCriteria): Episode[] {
  const { search, showFilter, favoritesOnly, guestFilter, categoryFilter, seriesFilter, bookmarkedIds, playableOnly } = criteria;
  let list = episodes;

  // Playable now (outage mode)
  if (playableOnly) {
    list = list.filter((ep) => !ep.fileHash?.startsWith("archive:") || playableOnly.has(ep.fileHash));
  }

  // Show type filter
  if (showFilter !== "all") {
    list = list.filter((ep) => (ep.showType ?? "unknown") === showFilter);
  }

  // Favorites filter
  if (favoritesOnly) {
    list = list.filter((ep) => !!ep.favoritedAt);
  }

  // Guest filter
  if (guestFilter) {
    list = list.filter((ep) => ep.guestName === guestFilter);
  }

  // Category filter
  if (categoryFilter) {
    list = list.filter((ep) => ep.aiCategory === categoryFilter);
  }

  // Series filter
  if (seriesFilter) {
    list = list.filter((ep) => ep.aiSeries === seriesFilter);
  }

  // Search filter with operator support
  if (search.trim()) {
    const parsed = parseSearch(search);

    // Apply operators
    if (parsed.guest) {
      const g = parsed.guest;
      list = list.filter((ep) => ep.guestName?.toLowerCase().includes(g));
    }
    if (parsed.year) {
      const y = parsed.year;
      list = list.filter((ep) => ep.airDate?.startsWith(y));
    }
    if (parsed.tag) {
      const t = parsed.tag;
      list = list.filter((ep) => ep.aiTags?.some((tag) => tag.toLowerCase().includes(t)));
    }
    if (parsed.show) {
      const s = parsed.show;
      list = list.filter((ep) => ep.showType === s);
    }
    if (parsed.cat) {
      const c = parsed.cat;
      list = list.filter((ep) => ep.aiCategory?.toLowerCase().includes(c));
    }
    if (parsed.series) {
      const s = parsed.series;
      list = list.filter((ep) => ep.aiSeries?.toLowerCase().includes(s));
    }
    if (parsed.has && parsed.has.length > 0) {
      for (const h of parsed.has) {
        if (h === "favorite" || h === "fav") {
          list = list.filter((ep) => !!ep.favoritedAt);
        } else if (h === "bookmark") {
          list = list.filter((ep) => bookmarkedIds?.has(ep.id!));
        } else if (h === "summary") {
          list = list.filter((ep) => !!ep.aiSummary);
        } else if (h === "played") {
          list = list.filter((ep) => (ep.playCount ?? 0) > 0);
        } else if (h === "notable") {
          list = list.filter((ep) => !!ep.aiNotable);
        } else if (h === "rated") {
          list = list.filter((ep) => !!ep.rating);
        } else if (h === "series") {
          list = list.filter((ep) => !!ep.aiSeries);
        }
      }
    }

    // Duration filter (input in minutes, stored in seconds)
    if (parsed.duration) {
      const { op, value } = parsed.duration;
      const secs = value * 60;
      list = list.filter((ep) => {
        if (ep.duration == null) return false;
        return matchComparison(ep.duration, op, secs);
      });
    }

    // Rating filter
    if (parsed.rating) {
      const { op, value } = parsed.rating;
      list = list.filter((ep) => {
        if (!ep.rating) return false;
        return matchComparison(ep.rating, op, value);
      });
    }

    // Favorited filter
    if (parsed.favorited) {
      list = list.filter((ep) => !!ep.favoritedAt);
    }

    // Free-text search on remaining terms
    if (parsed.text) {
      const q = parsed.text.toLowerCase();
      list = list.filter(
        (ep) =>
          ep.fileName.toLowerCase().includes(q) ||
          ep.title?.toLowerCase().includes(q) ||
          ep.guestName?.toLowerCase().includes(q) ||
          ep.topic?.toLowerCase().includes(q) ||
          ep.airDate?.includes(q) ||
          ep.description?.toLowerCase().includes(q) ||
          ep.aiCategory?.toLowerCase().includes(q) ||
          ep.aiSeries?.toLowerCase().includes(q) ||
          ep.aiTags?.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
  }

  return list;
}

/**
 * Order an already-filtered list. Never mutates its input.
 *
 * Two quirks are the page's own and are kept on purpose (this is a refactor):
 *   - an active series filter overrides `sortMode` entirely and orders by part;
 *   - "progress" is a filter as well as a sort — it keeps only episodes between
 *     5% and 95% played — and, like every other mode, is ignored under a series
 *     filter.
 */
export function sortEpisodes(
  list: Episode[],
  sortMode: SortMode,
  seriesFilter: string | null,
  community: CommunityIndex = NO_COMMUNITY,
  progress: ProgressIndex = NO_PROGRESS,
): Episode[] {
  // "recent" and "progress" order by the listener's progress, which lives in
  // its own table (HD-016) and arrives as `progress`, keyed by fileHash.
  const playedAt = (ep: Episode) => progress.get(ep.fileHash)?.lastPlayedAt ?? 0;
  const position = (ep: Episode) => progress.get(ep.fileHash)?.playbackPosition ?? 0;
  if (seriesFilter) {
    // When filtering by series, sort by part number (fallback to airDate)
    return [...list].sort((a, b) => {
      const partA = a.aiSeriesPart ?? 999;
      const partB = b.aiSeriesPart ?? 999;
      return partA - partB || (a.airDate ?? "").localeCompare(b.airDate ?? "");
    });
  } else if (sortMode === "date-asc") {
    // An explicit sort rather than reversing the input: reversing would also
    // reverse the order of same-day rows. Rows without a date go last, as
    // they would at the bottom of any date listing.
    return [...list].sort((a, b) => {
      if (!a.airDate || !b.airDate) return (a.airDate ? 0 : 1) - (b.airDate ? 0 : 1);
      return a.airDate.localeCompare(b.airDate);
    });
  } else if (sortMode === "name") {
    return [...list].sort((a, b) => {
      const nameA = (a.title || a.fileName).toLowerCase();
      const nameB = (b.title || b.fileName).toLowerCase();
      return nameA.localeCompare(nameB);
    });
  } else if (sortMode === "guest") {
    return [...list].sort((a, b) => {
      const gA = (a.guestName || "").toLowerCase();
      const gB = (b.guestName || "").toLowerCase();
      return gA.localeCompare(gB) || (a.airDate ?? "").localeCompare(b.airDate ?? "");
    });
  } else if (sortMode === "recent") {
    return [...list].sort((a, b) => playedAt(b) - playedAt(a));
  } else if (sortMode === "progress") {
    return [...list]
      .filter((ep) => ep.duration && position(ep) && position(ep) / ep.duration > 0.05 && position(ep) / ep.duration < 0.95)
      .sort((a, b) => playedAt(b) - playedAt(a));
  } else if (isNumericSort(sortMode)) {
    // Descending on the sort's own number (sort-keys.ts) — the same number
    // the rail buckets and the column shows — then, for "rated", on how many
    // people rated it. The rating sorts break remaining ties newest first, as
    // "rated" always did; the play sorts leave ties in input order (stable).
    const mode = sortMode;
    const byDate = mode === "rated" || mode === "my-rating";
    return [...list].sort(
      (a, b) =>
        sortValue(b, mode, community) - sortValue(a, mode, community) ||
        sortTiebreak(b, mode, community) - sortTiebreak(a, mode, community) ||
        (byDate ? (b.airDate ?? "").localeCompare(a.airDate ?? "") : 0),
    );
  }
  // "date" is already the default order from Dexie (airDate desc)
  return list;
}

/** The list the library renders: `filterEpisodes` then `sortEpisodes`. */
export function selectLibraryEpisodes(
  episodes: Episode[] | undefined,
  criteria: LibraryCriteria & { sortMode: SortMode },
  community: CommunityIndex = NO_COMMUNITY,
  progress: ProgressIndex = NO_PROGRESS,
): Episode[] {
  if (!episodes) return [];
  return sortEpisodes(filterEpisodes(episodes, criteria), criteria.sortMode, criteria.seriesFilter, community, progress);
}
