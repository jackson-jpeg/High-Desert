"use client";

import { useEffect, useState } from "react";
import { usePlayerStore } from "@/stores/player-store";
import { LARGE_EPISODE_BYTES } from "@/lib/utils/format";

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
  const large = usePlayerStore(
    (s) => (s.currentEpisode?.fileSize ?? 0) >= LARGE_EPISODE_BYTES,
  );
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

  // A 190MB rip is genuinely slow to start and there is nothing wrong with it.
  // Waiting the usual 4s to say so means the listener spends those 4s deciding
  // the site is broken — on exactly the episodes where they are most likely to
  // be right about the wait and wrong about the cause. So when we already know
  // the file is large, skip the neutral phase and explain immediately.
  if (large) {
    if (elapsed < 800) return null;
    if (elapsed < 12000) return "Tuning in… this is a big recording, give it a moment.";
    return "Still trying — a long broadcast on a slow signal.";
  }

  if (elapsed < 1500) return null;
  if (elapsed < 4000) return "Tuning in…";
  if (elapsed < 9000) return "Tuning in… long broadcast, this one takes a moment.";
  return "Still trying — the signal is weak tonight.";
}
