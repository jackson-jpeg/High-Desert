"use client";

import { useEffect, useState } from "react";
import { serverNow, useLiveStore } from "@/stores/live-store";
import { useBreaksMuted } from "@/lib/live/breaks-pref";
import type { StationBreak } from "@/lib/live/breaks";

/** How far back the lines keep a break's card. */
export const BREAK_CARD_KEEP_MS = 6 * 3_600_000;

/** Pure: the breaks whose card the lines draw at `now`. */
export function cardBreaks(breaks: readonly StationBreak[], now: number, muted: boolean): StationBreak[] {
  if (muted) return [];
  return breaks.filter((b) => b.card && b.start <= now && now - b.start <= BREAK_CARD_KEEP_MS);
}

/**
 * The station breaks the phone lines draw now (docs/station-breaks.md): those
 * with a card, from the published schedule, once their spot has started, for
 * six hours, unless this browser muted breaks. Re-renders at the next one.
 */
export function useStationBreakRows(): StationBreak[] {
  const breaks = useLiveStore((s) => s.schedule?.breaks);
  const [muted] = useBreaksMuted();
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    const next = (breaks ?? []).filter((b) => b.card && b.start > now).sort((a, b) => a.start - b.start)[0];
    if (!next) return;
    // A day's timer at most; a sleeping laptop is caught by the next schedule read.
    const id = setTimeout(() => setNow(serverNow()), Math.min(next.start - now + 50, 86_400_000));
    return () => clearTimeout(id);
  }, [breaks, now]);

  return cardBreaks(breaks ?? [], now, muted);
}
