"use client";

import { useState, useCallback, useDeferredValue, useEffect, useRef } from "react";
import { SORT_MODES, type ShowFilter, type SortMode } from "@/lib/library/filter-episodes";
import { getPreference, setPreference } from "@/db";

/** UserPrefs key holding the visitor's last chosen sort. */
export const SORT_PREF_KEY = "library-sort";

function isSortMode(v: unknown): v is SortMode {
  return typeof v === "string" && (SORT_MODES as readonly string[]).includes(v);
}

/**
 * The library's filter and sort state. `deferredSearch` is what the list and
 * the search-dependent chrome read; `search` is what the box shows. Gating the
 * chrome on the raw value collapsed it a frame before the list changed, so the
 * list jumped on every keystroke.
 */
export function useLibraryFilters() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  // Starts at "date" on the server and the first client render alike, and the
  // remembered sort is applied after mount — reading it during render would be
  // a hydration mismatch (compare useAdminStore.hydrate).
  const [sortMode, setSortModeState] = useState<SortMode>("date");
  // Set once anything chooses a sort. A stored value that arrives after that
  // must not overwrite it — a `?sort=` intent, a menu pick in the first few
  // milliseconds — so an explicit choice always wins over the remembered one.
  const sortChosen = useRef(false);

  const setSortMode = useCallback((mode: SortMode) => {
    sortChosen.current = true;
    setSortModeState(mode);
    // Remembered per visitor, in IndexedDB beside the rest of their library.
    // Best effort: a blocked or failing IndexedDB costs the memory, not the sort.
    setPreference(SORT_PREF_KEY, mode).catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    getPreference(SORT_PREF_KEY)
      .then((stored) => {
        if (live && !sortChosen.current && isSortMode(stored)) setSortModeState(stored);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const [showFilter, setShowFilter] = useState<ShowFilter>("all");
  const [guestFilter, setGuestFilter] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);

  const clearAllFilters = useCallback(() => {
    setShowFilter("all");
    setGuestFilter(null);
    setCategoryFilter(null);
    setSeriesFilter(null);
    setFavoritesOnly(false);
  }, []);

  const hasActiveFilters = showFilter !== "all" || guestFilter !== null || categoryFilter !== null || seriesFilter !== null || favoritesOnly;

  return {
    search, setSearch, deferredSearch,
    sortMode, setSortMode,
    showFilter, setShowFilter,
    guestFilter, setGuestFilter,
    favoritesOnly, setFavoritesOnly,
    categoryFilter, setCategoryFilter,
    seriesFilter, setSeriesFilter,
    clearAllFilters,
    hasActiveFilters,
  };
}

export type LibraryFilters = ReturnType<typeof useLibraryFilters>;
