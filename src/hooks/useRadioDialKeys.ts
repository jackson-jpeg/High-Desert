"use client";

import { useEffect } from "react";
import type { Episode } from "@/db/schema";
import type { DialStation } from "@/hooks/useRadioDial";
import { useRadioDialStore } from "@/stores/radio-dial-store";
import { isKeyOwnedByTarget } from "@/lib/utils/key-ownership";
import { emit } from "@/lib/events";

/**
 * How many dials are mounted with their keys. The desktop layout's global
 * player keys (Space, the arrows) stand aside while one is: on /radio they
 * always did by pathname, and the Library's Dial mode (the preview looks)
 * is on /library, where the pathname cannot say.
 */
let mountedDials = 0;

/** True while a radio dial owns the keyboard (see `mountedDials`). */
export function dialOwnsKeys(): boolean {
  return mountedDials > 0;
}

/**
 * The radio dial's window keys, shared by /radio (RadioDial) and the
 * Library's Dial mode (LibraryDial): arrows tune (Shift a month, Ctrl/Cmd a
 * year), Up/Down cycle shows on one date, Enter locks to the nearest, Space
 * plays the locked show, S scans, Escape stops a scan or calls `onEscape`.
 *
 * Keys a focused control owns are left alone (HD-011): Enter and Space on a
 * focused Seek/Play button or year tab press the button.
 */
export function useRadioDialKeys({
  tune,
  lockToNearest,
  lockedEpisode,
  scanning,
  stopScan,
  sameDateStations,
  cycleSubStation,
  ensureInitialized,
  onEscape,
}: {
  tune: (delta: number) => void;
  lockToNearest: () => void;
  lockedEpisode: Episode | null;
  scanning: "forward" | "backward" | null;
  stopScan: () => void;
  sameDateStations: DialStation[];
  cycleSubStation: (delta: number) => void;
  ensureInitialized: () => void;
  onEscape: () => void;
}) {
  useEffect(() => {
    mountedDials++;
    return () => {
      mountedDials--;
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept keys a focused control owns. This used to skip only
      // inputs, so Enter and Space on a focused Seek/Play button or year tab
      // locked the dial / started the locked show instead of pressing the
      // button (HD-011).
      if (isKeyOwnedByTarget(e)) return;

      switch (e.code) {
        case "ArrowLeft":
          e.preventDefault();
          ensureInitialized();
          if (e.ctrlKey || e.metaKey) tune(-365);
          else if (e.shiftKey) tune(-30);
          else tune(-1);
          break;

        case "ArrowRight":
          e.preventDefault();
          ensureInitialized();
          if (e.ctrlKey || e.metaKey) tune(365);
          else if (e.shiftKey) tune(30);
          else tune(1);
          break;

        case "ArrowUp":
          if (sameDateStations.length > 1) {
            e.preventDefault();
            cycleSubStation(-1);
          }
          break;

        case "ArrowDown":
          if (sameDateStations.length > 1) {
            e.preventDefault();
            cycleSubStation(1);
          }
          break;

        case "Enter":
          e.preventDefault();
          lockToNearest();
          break;

        case "Space":
          e.preventDefault();
          if (lockedEpisode) {
            emit("play-episode", lockedEpisode);
          }
          break;

        case "KeyS":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const { scanning: sc } = useRadioDialStore.getState();
            if (sc) stopScan();
            else useRadioDialStore.getState().startScan("forward");
          }
          break;

        case "Escape":
          e.preventDefault();
          if (scanning) {
            stopScan();
          } else {
            onEscape();
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    tune,
    lockToNearest,
    lockedEpisode,
    scanning,
    stopScan,
    sameDateStations,
    cycleSubStation,
    onEscape,
    ensureInitialized,
  ]);
}
