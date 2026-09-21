"use client";

import { useEffect } from "react";
import type { Episode } from "@/db/schema";
import { SORT_MODES, type SortMode } from "@/lib/library/filter-episodes";
import { currentItemHeight } from "@/hooks/useTextScale";
import { useHdEvent } from "@/lib/events";

/**
 * Every `hd:*` window event the library page answers. Moved out of `page.tsx`
 * in HD-018; typed through src/lib/events.ts in HD-019.
 */
export function useLibraryBusListeners({
  searchBarRef,
  setSortMode,
  setSearch,
  setCategoryFilter,
  setSeriesFilter,
  setSeedSettled,
  setGuestProfileName,
  setSelectedEpisode,
  setFocusedIndex,
  selectedEpisode,
  visibleEpisodes,
  currentEpisodeId,
  onShuffle,
  onQueue,
}: {
  searchBarRef: React.RefObject<HTMLInputElement | null>;
  setSortMode: (mode: SortMode) => void;
  setSearch: (q: string) => void;
  setCategoryFilter: (cat: string | null) => void;
  setSeriesFilter: (series: string | null) => void;
  setSeedSettled: (settled: boolean) => void;
  setGuestProfileName: (name: string | null) => void;
  setSelectedEpisode: (ep: Episode | null) => void;
  setFocusedIndex: (idx: number) => void;
  selectedEpisode: Episode | null;
  visibleEpisodes: Episode[];
  currentEpisodeId: number | undefined;
  onShuffle: (showType?: string) => void;
  onQueue: (episode: Episode) => void;
}) {
  // Listen for sort events from the menu bar
  useHdEvent("sort", (sort) => {
    if ((SORT_MODES as readonly string[]).includes(sort)) setSortMode(sort as SortMode);
  });

  useHdEvent("focus-search", () => {
    searchBarRef.current?.focus();
  });

  // The desktop layout fires this once seeding has resolved, either way.
  // The timeout is a backstop: on routes where the layout effect never runs,
  // or if it throws before dispatching, an empty library must still resolve.
  useHdEvent("seed-settled", () => setSeedSettled(true));
  useEffect(() => {
    const backstop = window.setTimeout(() => setSeedSettled(true), 8000);
    return () => window.clearTimeout(backstop);
  }, [setSeedSettled]);

  // Tag/category/guest/series click-to-filter, from the rows and detail panel
  useHdEvent("filter-tag", (tag) => {
    setSearch(`tag:${tag}`);
    setSelectedEpisode(null);
  });
  useHdEvent("filter-category", (cat) => {
    setCategoryFilter(cat);
    setSelectedEpisode(null);
  });
  useHdEvent("show-guest", (name) => {
    setGuestProfileName(name);
    setSelectedEpisode(null);
  });
  useHdEvent("filter-series", (series) => {
    setSeriesFilter(series);
    setSelectedEpisode(null);
  });
  // The Halloween "Ghost to Ghost" badge in the status bar has always
  // dispatched this, and nothing has ever listened for it — clicking the
  // badge did nothing at all.
  useHdEvent("search", (q) => {
    if (typeof q !== "string") return;
    setSearch(q);
    setSelectedEpisode(null);
  });

  // Scroll to currently playing episode
  useHdEvent("scroll-to-current", () => {
    if (!currentEpisodeId || !visibleEpisodes.length) return;
    const idx = visibleEpisodes.findIndex((ep) => ep.id === currentEpisodeId);
    if (idx !== -1) {
      setSelectedEpisode(visibleEpisodes[idx]);
      setFocusedIndex(idx);
      const container = document.querySelector('[role="listbox"]')?.parentElement;
      if (container) {
        const itemH = currentItemHeight();
        container.scrollTop = idx * itemH - container.clientHeight / 2 + itemH / 2;
      }
    }
  });

  useHdEvent("shuffle", (showType) => onShuffle(showType));

  // Q shortcut: queue currently selected episode
  useHdEvent("queue-selected", () => {
    if (selectedEpisode) onQueue(selectedEpisode);
  });
}
