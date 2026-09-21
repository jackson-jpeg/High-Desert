"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Episode } from "@/db/schema";
import type { SortMode } from "@/lib/library/filter-episodes";
import type { LibraryIntent, ShuffleScope } from "@/lib/library/intents";
import { currentItemHeight } from "@/hooks/useTextScale";
import { EPISODE_LISTBOX } from "@/hooks/library/useLibraryKeyboard";

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
 * shuffle"), scroll the first time the list has rows.
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
}) {
  const scrollToCurrent = useCallback(() => {
    if (!currentEpisodeId || !visibleEpisodes.length) return;
    const idx = visibleEpisodes.findIndex((ep) => ep.id === currentEpisodeId);
    if (idx === -1) return;
    setSelectedEpisode(visibleEpisodes[idx]);
    setFocusedIndex(idx);
    const container = document.querySelector(EPISODE_LISTBOX)?.parentElement;
    if (container) {
      const itemH = currentItemHeight();
      container.scrollTop = idx * itemH - container.clientHeight / 2 + itemH / 2;
    }
  }, [currentEpisodeId, visibleEpisodes, setSelectedEpisode, setFocusedIndex]);

  const pending = useRef<{ shuffle?: ShuffleScope; scroll?: boolean }>({});
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
      setReceived((n) => n + 1);
    },
    [setSortMode, setSearch, setSelectedEpisode],
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
  }, [received, allEpisodes, seedSettled, visibleEpisodes, onShuffle, scrollToCurrent]);

  return { applyIntent, scrollToCurrent };
}
