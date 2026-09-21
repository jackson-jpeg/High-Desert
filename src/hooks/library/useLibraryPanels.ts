"use client";

import { useState, useCallback, useEffect } from "react";
import { getPreference, setPreference } from "@/db";
import type { Episode } from "@/db/schema";

/**
 * The library's remembered panel state: the browse (facet) sidebar, the
 * Explore band, and the one-time mobile swipe tip. All persisted as prefs.
 */
export function useLibraryPanels({
  isMobile,
  allEpisodes,
}: {
  isMobile: boolean;
  allEpisodes: Episode[] | undefined;
}) {
  const [showFacets, setShowFacets] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [swipeTip, setSwipeTip] = useState(false);

  // Restore the browse panel's last state.
  useEffect(() => {
    let cancelled = false;
    getPreference("facets-open").then((val) => {
      if (!cancelled && val === "true") setShowFacets(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Sync discovery state from IndexedDB after hydration — default open on first visit
  useEffect(() => {
    let cancelled = false;
    getPreference("explore-collapsed").then((val) => {
      if (cancelled) return;
      if (val === null || val === undefined) {
        // First visit — default open on desktop only, closed on mobile
        setDiscoveryOpen(window.innerWidth >= 768);
      } else {
        setDiscoveryOpen(val !== "true");
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Show swipe gesture tip once on mobile (persisted in IndexedDB)
  useEffect(() => {
    if (!isMobile || !allEpisodes || allEpisodes.length === 0) return;
    let cancelled = false;
    getPreference("swipe-hint-dismissed").then((val) => {
      if (cancelled || val) return;
      setTimeout(() => { if (!cancelled) setSwipeTip(true); }, 1500);
    });
    return () => { cancelled = true; };
  }, [isMobile, allEpisodes]);

  const toggleDiscovery = useCallback(() => {
    setDiscoveryOpen((prev) => {
      const next = !prev;
      setPreference("explore-collapsed", String(!next));
      return next;
    });
  }, []);

  const toggleFacets = useCallback(() => {
    setShowFacets((prev) => {
      const next = !prev;
      setPreference("facets-open", String(next));
      return next;
    });
  }, []);

  const dismissSwipeTip = useCallback(() => {
    setSwipeTip(false);
    setPreference("swipe-hint-dismissed", "1");
  }, []);

  return { showFacets, toggleFacets, discoveryOpen, toggleDiscovery, swipeTip, dismissSwipeTip };
}
