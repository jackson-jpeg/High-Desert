"use client";

import { useEffect } from "react";
import type { Episode } from "@/db/schema";
import { SORT_MODES, type SortMode } from "@/lib/library/filter-episodes";
import { currentItemHeight } from "@/hooks/useTextScale";

/**
 * Every `hd:*` window event the library page answers. Moved out of `page.tsx`
 * unchanged (HD-018); HD-019 will type these.
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
  useEffect(() => {
    const handler = (e: Event) => {
      const sort = (e as CustomEvent<string>).detail;
      if ((SORT_MODES as readonly string[]).includes(sort)) setSortMode(sort as SortMode);
    };
    window.addEventListener("hd:sort", handler);
    return () => window.removeEventListener("hd:sort", handler);
  }, [setSortMode]);

  // Listen for focus-search events
  useEffect(() => {
    const handler = () => {
      searchBarRef.current?.focus();
    };
    window.addEventListener("hd:focus-search", handler);
    return () => window.removeEventListener("hd:focus-search", handler);
  }, [searchBarRef]);

  // The desktop layout fires this once seeding has resolved, either way.
  // The timeout is a backstop: on routes where the layout effect never runs,
  // or if it throws before dispatching, an empty library must still resolve.
  useEffect(() => {
    const handler = () => setSeedSettled(true);
    window.addEventListener("hd:seed-settled", handler);
    const backstop = window.setTimeout(handler, 8000);
    return () => {
      window.removeEventListener("hd:seed-settled", handler);
      window.clearTimeout(backstop);
    };
  }, [setSeedSettled]);

  // Listen for tag/category click-to-filter events from detail panel
  useEffect(() => {
    const handleTag = (e: Event) => {
      const tag = (e as CustomEvent<string>).detail;
      setSearch(`tag:${tag}`);
      setSelectedEpisode(null);
    };
    const handleCategory = (e: Event) => {
      const cat = (e as CustomEvent<string>).detail;
      setCategoryFilter(cat);
      setSelectedEpisode(null);
    };
    const handleGuest = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      setGuestProfileName(name);
      setSelectedEpisode(null);
    };
    const handleSeries = (e: Event) => {
      const series = (e as CustomEvent<string>).detail;
      setSeriesFilter(series);
      setSelectedEpisode(null);
    };
    // The Halloween "Ghost to Ghost" badge in the status bar has always
    // dispatched this, and nothing has ever listened for it — clicking the
    // badge did nothing at all.
    const handleSearch = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (typeof q !== "string") return;
      setSearch(q);
      setSelectedEpisode(null);
    };
    window.addEventListener("hd:search", handleSearch);
    window.addEventListener("hd:filter-tag", handleTag);
    window.addEventListener("hd:filter-category", handleCategory);
    window.addEventListener("hd:show-guest", handleGuest);
    window.addEventListener("hd:filter-series", handleSeries);
    return () => {
      window.removeEventListener("hd:search", handleSearch);
      window.removeEventListener("hd:filter-tag", handleTag);
      window.removeEventListener("hd:filter-category", handleCategory);
      window.removeEventListener("hd:show-guest", handleGuest);
      window.removeEventListener("hd:filter-series", handleSeries);
    };
  }, [setSearch, setCategoryFilter, setSeriesFilter, setGuestProfileName, setSelectedEpisode]);

  // Scroll to currently playing episode
  useEffect(() => {
    const handler = () => {
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
    };
    window.addEventListener("hd:scroll-to-current", handler);
    return () => window.removeEventListener("hd:scroll-to-current", handler);
  }, [currentEpisodeId, visibleEpisodes, setSelectedEpisode, setFocusedIndex]);

  // Listen for shuffle events from the menu bar
  useEffect(() => {
    const handler = (e: Event) => {
      const showType = (e as CustomEvent<string>).detail;
      onShuffle(showType);
    };
    window.addEventListener("hd:shuffle", handler);
    return () => window.removeEventListener("hd:shuffle", handler);
  }, [onShuffle]);

  // Q shortcut: queue currently selected episode
  useEffect(() => {
    const handler = () => {
      if (selectedEpisode) {
        onQueue(selectedEpisode);
      }
    };
    window.addEventListener("hd:queue-selected", handler);
    return () => window.removeEventListener("hd:queue-selected", handler);
  }, [selectedEpisode, onQueue]);
}
