"use client";

import { useState, useCallback, useDeferredValue } from "react";
import type { ShowFilter, SortMode } from "@/lib/library/filter-episodes";

/**
 * The library's filter and sort state. `deferredSearch` is what the list and
 * the search-dependent chrome read; `search` is what the box shows. Gating the
 * chrome on the raw value collapsed it a frame before the list changed, so the
 * list jumped on every keystroke.
 */
export function useLibraryFilters() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sortMode, setSortMode] = useState<SortMode>("date");
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
