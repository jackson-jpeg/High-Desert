"use client";

import { useCallback, useState } from "react";
import type { LibraryView } from "@/lib/library/intents";
import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";

/** sessionStorage: the mode a tab last browsed the library in. */
export const LIBRARY_VIEW_KEY = "hd-library-view";

function storedView(): LibraryView {
  if (typeof window === "undefined") return "list";
  return safeGetItem("session", LIBRARY_VIEW_KEY) === "dial" ? "dial" : "list";
}

/** List or Dial (src/lib/look/nav.ts): the radio dial is a Library mode. */
export function useLibraryView(): {
  view: LibraryView;
  setView: (view: LibraryView) => void;
  available: boolean;
} {
  const [view, setViewState] = useState<LibraryView>(storedView);
  const setView = useCallback((next: LibraryView) => {
    setViewState(next);
    // Private mode: the mode lasts as long as the page.
    safeSetItem("session", LIBRARY_VIEW_KEY, next);
  }, []);
  return { view, setView, available: true };
}
