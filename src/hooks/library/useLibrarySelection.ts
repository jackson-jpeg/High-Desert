"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { toast } from "@/stores/toast-store";
import { communityKey } from "@/lib/utils/community-key";

/**
 * Which episode the detail panel shows, the multi-selection, and the keyboard
 * focus row — plus the deep link that can open the panel on arrival.
 *
 * `visibleEpisodes` must be the array the list renders (from
 * `selectLibraryEpisodes`): shift-click ranges are indices into it.
 */
export function useLibrarySelection({
  allEpisodes,
  visibleEpisodes,
}: {
  allEpisodes: Episode[] | undefined;
  visibleEpisodes: Episode[];
}) {
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Deep links. `?ep=<communityKey>` is the shareable form — stable across
  // browsers. `?episode=<id>` is the old form and only ever worked in the
  // browser that generated it, since id is a local auto-increment; still
  // honoured so previously-shared links keep working for their author.
  //
  // The param is deliberately NOT stripped on arrival any more. It used to be
  // cleared immediately, which meant a refresh or a back-navigation dropped the
  // episode — for a link whose whole purpose is to survive being shared and
  // reopened. It is cleared when the panel is closed instead.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("ep");
    const legacyId = params.get("episode");
    if (!key && !legacyId) return;

    let cancelled = false;
    (async () => {
      let ep: Episode | undefined;
      if (key) {
        const all = await db.episodes.toArray();
        ep = all.find((e) => communityKey(e) === key);
      } else if (legacyId) {
        const id = parseInt(legacyId, 10);
        if (!isNaN(id)) ep = await db.episodes.get(id);
      }
      if (cancelled) return;
      if (ep) {
        setSelectedEpisode(ep);
      } else {
        toast.error("That episode link could not be found in this library.");
        window.history.replaceState({}, "", window.location.pathname);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleEpisodeClick = useCallback((episode: Episode, e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (e.shiftKey && lastClickedId != null) {
          const allIds = visibleEpisodes.map((ep) => ep.id!);
          const startIdx = allIds.indexOf(lastClickedId);
          const endIdx = allIds.indexOf(episode.id!);
          if (startIdx !== -1 && endIdx !== -1) {
            const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            for (let i = lo; i <= hi; i++) {
              next.add(allIds[i]);
            }
          }
        } else {
          if (next.has(episode.id!)) {
            next.delete(episode.id!);
          } else {
            next.add(episode.id!);
          }
        }
        return next;
      });
    } else {
      setSelectedIds(new Set());
      setSelectedEpisode(episode);
    }
    setLastClickedId(episode.id!);
  }, [visibleEpisodes, lastClickedId]);

  const handleCloseDetail = useCallback(() => {
    setSelectedEpisode(null);
    // Drop any deep-link param now the panel it opened is closed, so a later
    // refresh doesn't spring it back open.
    if (window.location.search) {
      const params = new URLSearchParams(window.location.search);
      if (params.has("ep") || params.has("episode")) {
        params.delete("ep");
        params.delete("episode");
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      }
    }
  }, []);

  /**
   * The selected episode, re-read from the live query on every change.
   *
   * `selectedEpisode` is a snapshot taken when the row was clicked, and nothing
   * refreshed it. Rating an episode wrote to IndexedDB correctly and the list
   * row updated, but the open detail panel kept rendering the stale object — so
   * the stars never filled in and the rating looked like it hadn't saved. It
   * had; closing and reopening the panel showed it.
   *
   * Falls back to the snapshot so the panel doesn't blank out if the row is
   * momentarily missing from the live result (e.g. mid-filter-change).
   */
  const selectedEpisodeLive = useMemo(() => {
    if (!selectedEpisode) return null;
    return allEpisodes?.find((e) => e.id === selectedEpisode.id) ?? selectedEpisode;
  }, [allEpisodes, selectedEpisode]);

  return {
    selectedEpisode, setSelectedEpisode,
    selectedEpisodeLive,
    selectedIds, setSelectedIds,
    focusedIndex, setFocusedIndex,
    handleEpisodeClick,
    handleCloseDetail,
  };
}

export type LibrarySelection = ReturnType<typeof useLibrarySelection>;
