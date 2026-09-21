"use client";

import { useEffect } from "react";
import type { Episode } from "@/db/schema";
import { useHdEvent } from "@/lib/events";

/**
 * The bus events the library page answers (src/lib/events.ts). Only events
 * that are emitted on /library itself belong here — the rows' and detail
 * panel's filter badges, and the layout's seed notification. Anything the
 * rest of the app asks of the library is a URL intent instead
 * (useLibraryIntents, HD-013): a listener here is not mounted on /stats.
 */
export function useLibraryBusListeners({
  setSearch,
  setCategoryFilter,
  setSeriesFilter,
  setSeedSettled,
  setGuestProfileName,
  setSelectedEpisode,
}: {
  setSearch: (q: string) => void;
  setCategoryFilter: (cat: string | null) => void;
  setSeriesFilter: (series: string | null) => void;
  setSeedSettled: (settled: boolean) => void;
  setGuestProfileName: (name: string | null) => void;
  setSelectedEpisode: (ep: Episode | null) => void;
}) {
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
}
