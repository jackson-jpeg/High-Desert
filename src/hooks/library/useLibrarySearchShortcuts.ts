"use client";

import { useEffect, useEffectEvent } from "react";

/**
 * The library's own keys: `/` and Ctrl/Cmd+F focus the search box, Q queues
 * the selected episode (HD-013).
 *
 * These were handled by the desktop layout on every route but /radio, and
 * turned into window events only the library answered. So on /stats and
 * /scanner, Ctrl+F was preventDefault-ed — the browser's find bar never
 * opened — and then went nowhere. Registered here, they exist only while the
 * library is mounted; everywhere else the browser keeps its keys.
 */
export function useLibrarySearchShortcuts({
  focusSearch,
  queueSelected,
}: {
  focusSearch: () => void;
  queueSelected: () => void;
}) {
  const onFocusSearch = useEffectEvent(focusSearch);
  const onQueueSelected = useEffectEvent(queueSelected);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // The layout's guard, for the same reasons: typing in a field, or a
      // control that owns the key itself (Ctrl+F in a text box is still the
      // browser's find).
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.tagName === "BUTTON" ||
        target.tagName === "A" ||
        target.isContentEditable ||
        target.getAttribute("role") === "button" ||
        target.closest("[role='menu'], [role='dialog'], [role='alertdialog']")
      ) {
        return;
      }

      if (e.code === "KeyQ" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onQueueSelected();
      } else if (e.code === "Slash" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onFocusSearch();
      } else if (e.code === "KeyF" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        onFocusSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
