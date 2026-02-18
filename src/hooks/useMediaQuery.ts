"use client";

import { useCallback, useSyncExternalStore } from "react";

function getServerSnapshot(): boolean {
  return false; // SSR: always false to avoid hydration mismatch (React #418)
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Returns true when viewport is below Tailwind `md:` (768px) */
export function useIsMobile(): boolean {
  return !useMediaQuery("(min-width: 768px)");
}
