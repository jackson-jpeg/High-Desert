"use client";

import { useEffect } from "react";
import type { Episode } from "@/db/schema";
import { useAdminStore } from "@/stores/admin-store";
import { isKeyOwnedByTarget } from "@/lib/utils/key-ownership";

/** The episode list: a focusable `role="listbox"` (TimelineView). */
export const EPISODE_LISTBOX = "[data-episode-listbox]";

/**
 * The library's window-level keyboard handling (HD-018, HD-021).
 *
 * The episode list is a single-select listbox with selection following
 * focus: moving the active row opens it in the detail panel.
 *
 * - **Up/Down** move the active row when the list has focus. Plain arrows
 *   anywhere else keep their usual meaning (scrolling, a focused control's
 *   own arrows), so they are only taken inside the list.
 * - **Shift+Up/Down** move it from anywhere on the page that does not own
 *   arrows — the older, page-wide binding, kept.
 * - **Home/End** jump to the first/last row, in the list.
 * - **Enter** plays the open episode; **Delete/Backspace** asks to delete it
 *   (admin); **Escape** dismisses one layer.
 *
 * Moves start from `activeIndex` — the selected row where it is now — so the
 * arrows continue from a row picked with the mouse. TimelineView keeps the
 * active row rendered and points `aria-activedescendant` at it.
 *
 * HD-011: keys a focused control owns (`isKeyOwnedByTarget`) are left alone —
 * Enter on a button presses the button, not "play" — and Delete/Backspace
 * only ever *requests* a delete; the confirmation dialog does the deleting.
 * The listbox deliberately owns nothing (key-ownership.ts): its keys are
 * these.
 */
export function useLibraryKeyboard({
  visibleEpisodes,
  activeIndex,
  setFocusedIndex,
  selectedEpisode,
  setSelectedEpisode,
  selectedIds,
  setSelectedIds,
  onPlay,
  onRequestBulkDelete,
  onRequestDelete,
}: {
  visibleEpisodes: Episode[];
  /** The list's active row (`useLibrarySelection`), or -1. */
  activeIndex: number;
  setFocusedIndex: React.Dispatch<React.SetStateAction<number>>;
  selectedEpisode: Episode | null;
  setSelectedEpisode: (ep: Episode | null) => void;
  selectedIds: Set<number>;
  setSelectedIds: (ids: Set<number>) => void;
  onPlay: (episode: Episode) => void;
  onRequestBulkDelete: () => void;
  /** Opens the delete confirmation for these ids. Must not delete. */
  onRequestDelete: (ids: number[]) => void;
}) {
  useEffect(() => {
    const moveTo = (next: number) => {
      const ep = visibleEpisodes[next];
      if (!ep) return;
      setFocusedIndex(next);
      setSelectedEpisode(ep);
    };

    const handler = (e: KeyboardEvent) => {
      if (isKeyOwnedByTarget(e)) return;
      const inList = e.target instanceof Element && e.target.closest(EPISODE_LISTBOX) !== null;
      const last = visibleEpisodes.length - 1;

      if (e.code === "ArrowUp" && (e.shiftKey || inList)) {
        e.preventDefault();
        moveTo(Math.max(0, activeIndex - 1));
      } else if (e.code === "ArrowDown" && (e.shiftKey || inList)) {
        e.preventDefault();
        moveTo(Math.min(last, activeIndex + 1));
      } else if ((e.code === "Home" || e.code === "End") && inList) {
        e.preventDefault();
        moveTo(e.code === "Home" ? 0 : last);
      } else if (e.code === "Enter" && selectedEpisode) {
        e.preventDefault();
        onPlay(selectedEpisode);
      } else if ((e.code === "Delete" || e.code === "Backspace") && useAdminStore.getState().isAdmin) {
        if (selectedIds.size > 0) {
          e.preventDefault();
          onRequestBulkDelete();
        } else if (selectedEpisode) {
          e.preventDefault();
          onRequestDelete([selectedEpisode.id!]);
        }
      } else if (e.code === "Escape") {
        // Dismiss one layer at a time. This used to clear the panel, the
        // multi-selection, the focus ring *and* all three filters in a single
        // keystroke, with no undo — so one stray Escape destroyed a carefully
        // built filter state. Filters are cleared from the chips or the
        // over-constrained empty state, both of which are explicit.
        if (selectedEpisode) {
          // The row stays active; only the selection goes.
          setFocusedIndex(activeIndex);
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
  }, [visibleEpisodes, activeIndex, selectedEpisode, selectedIds, onPlay, onRequestBulkDelete, onRequestDelete, setFocusedIndex, setSelectedEpisode, setSelectedIds]);
}
