import { describe, it, expect } from "vitest";
import { libraryListState } from "@/lib/library/list-state";

/**
 * Which empty state the library draws (HD-035). The one that was wrong: an
 * empty "In Progress" view with no search and no filters fell through to the
 * "No episodes yet — start building your archive" copy, in a full library.
 */
const base = { libraryCount: 1312, visibleCount: 0, search: "", hasActiveFilters: false, sortMode: "date" as const, seriesFilter: null };

describe("libraryListState", () => {
  it("an empty library is an empty library, whatever else is set", () => {
    expect(libraryListState({ ...base, libraryCount: 0 })).toBe("empty-library");
    expect(libraryListState({ ...base, libraryCount: 0, sortMode: "progress" })).toBe("empty-library");
  });

  it("rows to show means the list", () => {
    expect(libraryListState({ ...base, visibleCount: 3, sortMode: "progress" })).toBe("list");
  });

  it("an empty In Progress view says nothing is in progress — not that the library is empty", () => {
    expect(libraryListState({ ...base, sortMode: "progress" })).toBe("nothing-in-progress");
  });

  it("In Progress with a search or filter still says so (the progress filter is the one that emptied it)", () => {
    expect(libraryListState({ ...base, sortMode: "progress", search: "mars" })).toBe("nothing-in-progress");
    expect(libraryListState({ ...base, sortMode: "progress", hasActiveFilters: true })).toBe("nothing-in-progress");
  });

  it("a series filter overrides the sort, In Progress included, so an empty series view is a filter miss", () => {
    expect(libraryListState({ ...base, sortMode: "progress", hasActiveFilters: true, seriesFilter: "Mel's Hole" })).toBe("no-filter-matches");
  });

  it("a search with no results, then over-constrained filters", () => {
    expect(libraryListState({ ...base, search: "zzz" })).toBe("no-search-matches");
    expect(libraryListState({ ...base, search: "  " , hasActiveFilters: true })).toBe("no-filter-matches");
    expect(libraryListState({ ...base, search: "zzz", hasActiveFilters: true })).toBe("no-search-matches");
  });
});
