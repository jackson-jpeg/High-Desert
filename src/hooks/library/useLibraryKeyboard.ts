"use client";

import { useEffect } from "react";
import type { Episode } from "@/db/schema";
import { useAdminStore } from "@/stores/admin-store";
import { deleteEpisode } from "@/services/episodes/management";
import { currentItemHeight } from "@/hooks/useTextScale";

/**
 * The library's window-level keyboard handling, moved out of `page.tsx`
 * unchanged (HD-018). Shift+Up/Down moves the focus row and opens it, Enter
 * plays the open episode, Delete/Backspace deletes (admin), Escape dismisses
 * one layer. HD-021 changes this behaviour; this file only gives it a home.
 */
export function useLibraryKeyboard({
  visibleEpisodes,
  focusedIndex,
  setFocusedIndex,
  selectedEpisode,
  setSelectedEpisode,
  selectedIds,
  setSelectedIds,
  onPlay,
  onRequestBulkDelete,
}: {
  visibleEpisodes: Episode[];
  focusedIndex: number;
  setFocusedIndex: React.Dispatch<React.SetStateAction<number>>;
  selectedEpisode: Episode | null;
  setSelectedEpisode: (ep: Episode | null) => void;
  selectedIds: Set<number>;
  setSelectedIds: (ids: Set<number>) => void;
  onPlay: (episode: Episode) => void;
  onRequestBulkDelete: () => void;
}) {
  // Scroll to focused item on keyboard navigation
  useEffect(() => {
    if (focusedIndex < 0) return;
    const container = document.querySelector('[role="listbox"]')?.parentElement;
    if (!container) return;
    const itemH = currentItemHeight();
    const targetTop = focusedIndex * itemH;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (targetTop < viewTop || targetTop + itemH > viewBottom) {
      container.scrollTop = targetTop - container.clientHeight / 2 + itemH / 2;
    }
  }, [focusedIndex]);

  // Keyboard navigation for the library list
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.code === "ArrowUp" && e.shiftKey) {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.max(0, prev - 1);
          const ep = visibleEpisodes[next];
          if (ep) setSelectedEpisode(ep);
          return next;
        });
      } else if (e.code === "ArrowDown" && e.shiftKey) {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.min(visibleEpisodes.length - 1, prev + 1);
          const ep = visibleEpisodes[next];
          if (ep) setSelectedEpisode(ep);
          return next;
        });
      } else if (e.code === "Enter" && selectedEpisode) {
        e.preventDefault();
        onPlay(selectedEpisode);
      } else if ((e.code === "Delete" || e.code === "Backspace") && useAdminStore.getState().isAdmin) {
        if (selectedIds.size > 0) {
          e.preventDefault();
          onRequestBulkDelete();
        } else if (selectedEpisode) {
          e.preventDefault();
          deleteEpisode(selectedEpisode.id!).then(() => setSelectedEpisode(null));
        }
      } else if (e.code === "Escape") {
        // Dismiss one layer at a time. This used to clear the panel, the
        // multi-selection, the focus ring *and* all three filters in a single
        // keystroke, with no undo — so one stray Escape destroyed a carefully
        // built filter state. Filters are cleared from the chips or the
        // over-constrained empty state, both of which are explicit.
        if (selectedEpisode) {
          setSelectedEpisode(null);
        } else if (selectedIds.size > 0) {
          setSelectedIds(new Set());
        } else {
          setFocusedIndex(-1);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visibleEpisodes, focusedIndex, selectedEpisode, selectedIds, onPlay, onRequestBulkDelete, setFocusedIndex, setSelectedEpisode, setSelectedIds]);
}
