"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * `serverValue` is what the query reports during SSR **and during hydration**:
 * React renders the hydration pass from the server snapshot so the markup
 * matches (React #418), then re-renders with the real `matchMedia` answer.
 * So it is the layout every visitor's first render gets, whatever the device.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
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

  const getServerSnapshot = useCallback(() => serverValue, [serverValue]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Returns true when viewport is below Tailwind `md:` (768px).
 *
 * Desktop is the server answer (HD-037). The query is `min-width: 768px`, and
 * with the old fixed `false` server snapshot `useIsMobile()` was **true** on
 * the server and through hydration — every desktop visit rendered the mobile
 * tree first (glass player, bottom tabs, mobile sheets), mounted its effects,
 * then tore it down for the desktop one. The boot splash hid most of it, but
 * not when a key or tap dismissed the splash before hydration finished.
 */
export function useIsMobile(): boolean {
  return !useMediaQuery("(min-width: 768px)", true);
}
