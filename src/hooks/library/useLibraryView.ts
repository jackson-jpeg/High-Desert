"use client";

import { useCallback, useEffect, useState } from "react";
import type { LibraryView } from "@/lib/library/intents";
import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";

/** sessionStorage: the mode a tab last browsed the library in. */
export const LIBRARY_VIEW_KEY = "hd-library-view";

function storedView(): LibraryView {
  if (typeof window === "undefined") return "list";
  return safeGetItem("session", LIBRARY_VIEW_KEY) === "dial" ? "dial" : "list";
}

/**
 * List or Dial (src/lib/look/nav.ts): the radio dial is a Library mode.
 *
 * The first render is always List, as the server's is; the tab's stored mode
 * is applied after mount. Reading sessionStorage in the useState initializer
 * (until 2026-11-27) rendered Dial on the client over the server's List after
 * a reload: React error #418, a client re-render of the whole document, and a
 * new #app-loading the boot script had already dismissed once, so the boot
 * screen stayed over the Library for good (docs/UI-PLAN.md, "Found while
 * shooting").
 */
export function useLibraryView(): {
  view: LibraryView;
  setView: (view: LibraryView) => void;
  available: boolean;
} {
  const [view, setViewState] = useState<LibraryView>("list");
  useEffect(() => {
    const stored = storedView();
    if (stored !== "list") setViewState(stored);
  }, []);
  const setView = useCallback((next: LibraryView) => {
    setViewState(next);
    // Private mode: the mode lasts as long as the page.
    safeSetItem("session", LIBRARY_VIEW_KEY, next);
  }, []);
  return { view, setView, available: true };
}
