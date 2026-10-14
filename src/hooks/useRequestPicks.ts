"use client";

import { useEffect, useState } from "react";
import { fetchRequestLine } from "@/services/live/request-client";

/** How often an open Live screen asks the Request Line for its count. */
export const PICKS_POLL_MS = 120_000;

/**
 * How many shows are in the running for `day` (docs/request-line.md), for
 * the Live note's "3 shows in the running". Asked only while `enabled`
 * (voting is open), on mount, every two minutes on screen, and on coming back
 * on screen. Null until known, when the Request Line does not answer, or when
 * it answers for another day (after 6 PM picks are for tomorrow).
 */
export function useRequestPicks(day: string, enabled: boolean): number | null {
  const [picks, setPicks] = useState<{ day: string; n: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const ask = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const state = await fetchRequestLine();
      if (live && state && Array.isArray(state.nominations)) setPicks({ day: state.day, n: state.nominations.length });
    };
    void ask();
    const id = setInterval(ask, PICKS_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [day, enabled]);
  return enabled && picks?.day === day ? picks.n : null;
}
