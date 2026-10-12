"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { reportView, takeArrival, viewPayload } from "@/services/stats/usage-client";

/**
 * How long a tab must stay entered to count as a view. The welcome page sends
 * a returning visitor on to /library (and a phone to /live) at once; that
 * bounce is not a visit to the welcome page.
 */
export const VIEW_SETTLE_MS = 1000;

/**
 * Counts a view of each tab entered, client-side navigation included
 * (docs/usage-tracking.md). Mounted once, in the root layout, so every page is
 * covered, the welcome page and the show pages too. Renders nothing.
 *
 * The session's arrival rides with its first view, its landing tab being the
 * first path this browser session loaded (not the tab the bounce settled on).
 */
export function UsageTracker() {
  const pathname = usePathname();
  const landing = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (landing.current === null) landing.current = pathname;
    const timer = setTimeout(() => {
      reportView(viewPayload(pathname, takeArrival(landing.current ?? pathname)));
    }, VIEW_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}
