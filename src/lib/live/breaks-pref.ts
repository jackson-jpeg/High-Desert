import { useSyncExternalStore } from "react";
import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";

/**
 * "Mute breaks" (docs/station-breaks.md): this browser skips the station
 * breaks' spots (the station ID plays in their place) and the chat hides
 * their cards. Set from the card's button or the lines' setting (Night: the
 * header; Win98 Notepad: Format menu).
 */
export const BREAKS_MUTED_KEY = "hd-breaks-muted";

const listeners = new Set<() => void>();

export function breaksMuted(): boolean {
  return safeGetItem("local", BREAKS_MUTED_KEY) === "1";
}

export function setBreaksMuted(on: boolean): void {
  safeSetItem("local", BREAKS_MUTED_KEY, on ? "1" : "0");
  for (const fn of [...listeners]) fn();
}

export function onBreaksMutedChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBreaksMuted(): [boolean, (on: boolean) => void] {
  const muted = useSyncExternalStore(onBreaksMutedChange, breaksMuted, () => false);
  return [muted, setBreaksMuted];
}
