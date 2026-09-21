/**
 * Which of the library's list states to draw. Pure, so the choice is testable
 * without mounting the page.
 *
 * "In Progress" is a filter as well as a sort (`sortEpisodes` keeps only shows
 * between 5% and 95% played), but the empty check used to look only at the
 * search box and the sidebar filters. With neither set, an empty In Progress
 * view fell through to TimelineView's own empty state — "No episodes yet.
 * Start building your late-night radio archive" — told to a listener with
 * 1,312 episodes who simply has not stopped one partway through (HD-035).
 */

import type { SortMode } from "@/lib/library/filter-episodes";

export type LibraryListState =
  | "empty-library"
  | "nothing-in-progress"
  | "no-search-matches"
  | "no-filter-matches"
  | "list";

export function libraryListState({
  libraryCount,
  visibleCount,
  search,
  hasActiveFilters,
  sortMode,
  seriesFilter,
}: {
  libraryCount: number;
  visibleCount: number;
  search: string;
  hasActiveFilters: boolean;
  sortMode: SortMode;
  /** A series filter overrides the sort, "progress" included (`sortEpisodes`). */
  seriesFilter: string | null;
}): LibraryListState {
  if (libraryCount === 0) return "empty-library";
  if (visibleCount > 0) return "list";
  if (sortMode === "progress" && !seriesFilter) return "nothing-in-progress";
  if (search.trim()) return "no-search-matches";
  if (hasActiveFilters) return "no-filter-matches";
  return "list";
}
