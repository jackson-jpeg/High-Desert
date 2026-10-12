"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Episode } from "@/db/schema";
import type { SortMode } from "@/lib/library/filter-episodes";
import type { LibraryIntent, LibraryView, ShuffleScope } from "@/lib/library/intents";
import { scrollListToRow } from "@/lib/library/list-scroll";
import { communityKey } from "@/lib/utils/community-key";
import { toast } from "@/stores/toast-store";

/**
 * Applies library intents (HD-013) — what LibraryIntentReader hands over from
 * the URL — and owns "scroll to the show that is playing", which the floating
 * now-playing button calls directly.
 *
 * Sort and search are state and apply at once. Shuffle and scroll need data
 * that may not exist yet when the intent arrives with the page — on a cold
 * load the live query is still pending, on a first visit seeding may still be
 * running — so they wait here until it does, rather than behind a
 * `setTimeout` guess. Each fires once: shuffle when the catalog has loaded (or
 * seeding has settled on an empty one, which answers "No episodes to
 * shuffle"), scroll the first time the list has rows, and a show (`?show=`,
 * from a show page's "Open in High Desert") once the library holds it, or once
 * seeding has settled without it, which says so. `?resume=` (the welcome
 * page's Continue listening) is a show too, started through `onPlay` (the
 * library's own play, i.e. `play-episode`) once the library holds it.
 */
export function useLibraryIntents({
  allEpisodes,
  visibleEpisodes,
  seedSettled,
  currentEpisodeId,
  setSortMode,
  setSearch,
  setSelectedEpisode,
  setFocusedIndex,
  onShuffle,
  setView,
  onPlay,
}: {
  allEpisodes: Episode[] | undefined;
  visibleEpisodes: Episode[];
  seedSettled: boolean;
  currentEpisodeId: number | undefined;
  setSortMode: (mode: SortMode) => void;
  setSearch: (q: string) => void;
  setSelectedEpisode: (ep: Episode | null) => void;
  setFocusedIndex: (idx: number) => void;
  onShuffle: (scope: ShuffleScope) => void;
  /** List or Dial. The page decides whether a look has the dial at all. */
  setView?: (view: LibraryView) => void;
  /** Start a show: the library's play-episode emit. */
  onPlay?: (episode: Episode) => void;
}) {
  const scrollToCurrent = useCallback(() => {
    if (!currentEpisodeId || !visibleEpisodes.length) return;
    const idx = visibleEpisodes.findIndex((ep) => ep.id === currentEpisodeId);
    if (idx === -1) return;
    setSelectedEpisode(visibleEpisodes[idx]);
    setFocusedIndex(idx);
    // Through the list's own layout: with group headers between the rows,
    // a row's offset is not index × row height (list-scroll.ts).
    scrollListToRow(idx);
  }, [currentEpisodeId, visibleEpisodes, setSelectedEpisode, setFocusedIndex]);

  const pending = useRef<{ shuffle?: ShuffleScope; scroll?: boolean; show?: string; resume?: string }>({});
  const [received, setReceived] = useState(0);

  const applyIntent = useCallback(
    (intent: LibraryIntent) => {
      // The URL's sort is the listener's choice now, whatever was restored.
      if (intent.sort) setSortMode(intent.sort);
      if (intent.q) {
        setSearch(intent.q);
        setSelectedEpisode(null);
      }
      if (intent.shuffle) pending.current.shuffle = intent.shuffle;
      if (intent.scroll) pending.current.scroll = true;
      if (intent.show) pending.current.show = intent.show;
      if (intent.view) setView?.(intent.view);
      if (intent.resume) pending.current.resume = intent.resume;
      setReceived((n) => n + 1);
    },
    [setSortMode, setSearch, setSelectedEpisode, setView],
  );

  useEffect(() => {
    const p = pending.current;
    if (p.shuffle && allEpisodes && (allEpisodes.length > 0 || seedSettled)) {
      const scope = p.shuffle;
      p.shuffle = undefined;
      onShuffle(scope);
    }
    if (p.scroll && visibleEpisodes.length > 0) {
      p.scroll = undefined;
      scrollToCurrent();
    }
    if (p.show && allEpisodes) {
      const key = p.show;
      const ep = allEpisodes.find((e) => communityKey(e) === key);
      if (ep) {
        p.show = undefined;
        setSelectedEpisode(ep);
        const idx = visibleEpisodes.findIndex((e) => e.id === ep.id);
        if (idx !== -1) {
          setFocusedIndex(idx);
          scrollListToRow(idx);
        }
      } else if (seedSettled) {
        p.show = undefined;
        toast.error("That show is not in this library.");
      }
    }
    if (p.resume && allEpisodes) {
      const key = p.resume;
      const ep = allEpisodes.find((e) => communityKey(e) === key);
      if (ep) {
        p.resume = undefined;
        onPlay?.(ep);
      } else if (seedSettled) {
        p.resume = undefined;
        toast.error("That show is not in this library.");
      }
    }
  }, [received, allEpisodes, seedSettled, visibleEpisodes, onShuffle, scrollToCurrent, setSelectedEpisode, setFocusedIndex, onPlay]);

  return { applyIntent, scrollToCurrent };
}
