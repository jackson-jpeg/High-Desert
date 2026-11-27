"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    /** Set by the boot script (src/app/boot-script.ts) the moment it dismisses #app-loading. */
    __hdBootDismissed?: boolean;
  }
}

/**
 * Hide a boot screen React drew again after the boot script had already
 * dismissed it.
 *
 * The boot script dismisses #app-loading once. When hydration fails (React
 * error #418), React renders the whole document again on the client, and the
 * root layout's #app-loading comes back with it, visible, with nothing left
 * to dismiss it: on 2026-11-27 a reload of the Library after using the Dial
 * sat under the boot screen for good. The script says on `window` that it
 * dismissed; a component mounted by that second render reads it here.
 *
 * It acts only after the script's own dismissal, so the first visit's boot
 * sequence keeps its time. Mounted by the two components that carry
 * `data-hydrated`: the app layout and the welcome page.
 */
export function useBootScreenGuard(): void {
  useEffect(() => {
    if (!window.__hdBootDismissed) return;
    const el = document.getElementById("app-loading");
    if (!el || el.style.display === "none") return;
    el.style.pointerEvents = "none";
    el.style.display = "none";
  }, []);
}
