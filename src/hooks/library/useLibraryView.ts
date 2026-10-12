"use client";

import { useCallback, useState } from "react";
import type { LibraryView } from "@/lib/library/intents";
import { currentLook } from "@/hooks/useLook";
import { radioRetired } from "@/lib/look/nav";
import type { Look } from "@/lib/look/look";
import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";

/** sessionStorage: the mode a tab last browsed the library in. */
export const LIBRARY_VIEW_KEY = "hd-library-view";

function storedView(): LibraryView {
  if (typeof window === "undefined") return "list";
  return safeGetItem("session", LIBRARY_VIEW_KEY) === "dial" ? "dial" : "list";
}

/**
 * List or Dial (src/lib/look/nav.ts). Dial exists only where the Radio tab is
 * retired, i.e. the preview looks; the public look is always "list", and a
 * `?view=dial` there changes nothing at all, not even this tab's storage.
 *
 * The gate on a change reads the page's look directly (`currentLook`), not
 * `look`: an intent arrives in an effect of the hydration render, while
 * `useLook()` still answers "default".
 */
export function useLibraryView(look: Look): {
  view: LibraryView;
  setView: (view: LibraryView) => void;
  available: boolean;
} {
  const [view, setViewState] = useState<LibraryView>(storedView);
  const setView = useCallback((next: LibraryView) => {
    if (!radioRetired(currentLook())) return;
    setViewState(next);
    // Private mode: the mode lasts as long as the page.
    safeSetItem("session", LIBRARY_VIEW_KEY, next);
  }, []);
  const available = radioRetired(look);
  return { view: available ? view : "list", setView, available };
}
