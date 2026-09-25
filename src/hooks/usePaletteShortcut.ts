"use client";

import { useEffect, useRef } from "react";

/**
 * Ctrl/Cmd+K toggles the command palette. Extracted from DesktopShell so the
 * real listener can be mounted in a test (src/hooks/__tests__/palette-shortcut.test.tsx).
 *
 * `e.key` is the *produced character*, so with Caps Lock on (or Shift held)
 * it is "K", and the comparison against "k" used to miss it — the shortcut
 * simply did nothing for anyone typing in capitals (HD-040).
 */
export function usePaletteShortcut(toggle: () => void): void {
  const latest = useRef(toggle);
  useEffect(() => {
    latest.current = toggle;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key?.toLowerCase() === "k") {
        e.preventDefault();
        latest.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
