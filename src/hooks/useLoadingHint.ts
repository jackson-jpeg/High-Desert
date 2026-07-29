"use client";

import { useEffect, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Copy for the gap between a tap and the first sound.
 *
 * The player had nothing to say here. `buffering` only goes true once the
 * element fires `waiting`, which on a cold connection to a 60MB show can be
 * many seconds after the tap — and if the connection hangs outright, never. So
 * the honest answer to "did my tap register" was a static ▶.
 *
 * Escalates with elapsed time because the useful message changes: at first
 * there is nothing to say, then it is worth confirming we heard the tap, then
 * worth explaining why a three-hour broadcast is slower than a song. People
 * tolerate slow much better than they tolerate ambiguous.
 *
 * Returns null when there is nothing worth saying.
 */
export function useLoadingHint(): string | null {
  const loadState = usePlayerStore((s) => s.loadState);
  const loadStartedAt = usePlayerStore((s) => s.loadStartedAt);
  // Only the interval writes this; elapsed is derived below rather than stored,
  // so there is no setState on the effect's synchronous path.
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (loadState !== "loading" || loadStartedAt == null) return;
    // Half-second ticks so the thresholds below land near where they read.
    const id = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(id);
  }, [loadState, loadStartedAt]);

  if (loadState !== "loading" || loadStartedAt == null) return null;

  const elapsed = now - loadStartedAt;
  if (elapsed < 1500) return null;
  if (elapsed < 4000) return "Tuning in…";
  if (elapsed < 9000) return "Tuning in… long broadcast, this one takes a moment.";
  return "Still trying — the signal is weak tonight.";
}
