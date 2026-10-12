"use client";

import { useEffect } from "react";

/**
 * Hide the boot screen (#app-loading) once this component is on screen.
 *
 * For a page that can be drawn in the browser rather than by the server: the
 * 404 (`notFound()` on a dynamic route) and the error page. Next sends those as
 * an error shell and React draws the root layout itself, and a <script> React
 * inserts never runs, so the boot script (src/app/boot-script.ts) that would
 * have dismissed the overlay never did: "Signal Lost" sat under the boot screen
 * for good, a blank page to the listener.
 */
export function useDismissBootScreen(): void {
  useEffect(() => {
    const el = document.getElementById("app-loading");
    if (el) el.style.display = "none";
  }, []);
}
