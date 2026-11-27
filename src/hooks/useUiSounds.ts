"use client";

import { useSyncExternalStore } from "react";
import { UI_SOUNDS_EVENT, setUiSounds, uiSoundsOn, uiSoundsSupported } from "@/audio/ui-sounds";

function subscribe(onChange: () => void) {
  window.addEventListener(UI_SOUNDS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(UI_SOUNDS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The interface sounds switch: whether it is on, whether this device can have it, and the toggle. */
export function useUiSounds(): { on: boolean; supported: boolean; toggle: () => void } {
  const on = useSyncExternalStore(subscribe, uiSoundsOn, () => false);
  const supported = useSyncExternalStore(subscribe, uiSoundsSupported, () => false);
  return { on, supported, toggle: () => setUiSounds(!uiSoundsOn()) };
}
