"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  initRadioStatic,
  setStaticVolume,
  muteStatic,
  playLockTone,
  destroyRadioStatic,
  isRadioStaticInitialized,
} from "@/audio/radio-static";
import { usePlayerStore } from "@/stores/player-store";

interface UseRadioStaticOptions {
  signalStrength: number;
  isLocked: boolean;
  enabled: boolean;
}

export function useRadioStatic({
  signalStrength,
  isLocked,
  enabled,
}: UseRadioStaticOptions) {
  const wasLocked = useRef(false);
  const userInteracted = useRef(false);

  // Initialize on first user interaction
  const ensureInitialized = useCallback(() => {
    if (!userInteracted.current) {
      userInteracted.current = true;
      if (!isRadioStaticInitialized()) {
        initRadioStatic();
      }
    }
  }, []);

  // Mute static when main player is actively playing
  const mainPlayerPlaying = usePlayerStore((s) => s.playing);

  // Update static volume reactively
  useEffect(() => {
    if (!enabled || !userInteracted.current || mainPlayerPlaying) {
      muteStatic();
      return;
    }

    // Check reduced motion preference
    const noMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (noMotion) {
      muteStatic();
      return;
    }

    setStaticVolume(signalStrength);
  }, [signalStrength, enabled, mainPlayerPlaying]);

  // Play lock tone when signal locks
  useEffect(() => {
    if (isLocked && !wasLocked.current && userInteracted.current && enabled) {
      playLockTone();
    }
    wasLocked.current = isLocked;
  }, [isLocked, enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyRadioStatic();
    };
  }, []);

  return { ensureInitialized };
}
