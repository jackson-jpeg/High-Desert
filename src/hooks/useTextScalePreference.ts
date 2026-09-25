"use client";

import { useCallback, useEffect } from "react";
import { getPreference, setPreference } from "@/db";
import { toast } from "@/stores/toast-store";
import { useTextScale } from "@/hooks/useTextScale";
import { emit } from "@/lib/events";
import { safeSetItem } from "@/lib/utils/safe-storage";

export type TextScaleValue = "1" | "1.15" | "1.3";

export const TEXT_SCALE_OPTIONS: readonly { label: string; value: TextScaleValue }[] = [
  { label: "Normal", value: "1" },
  { label: "Large", value: "1.15" },
  { label: "Extra Large", value: "1.3" },
];

/** The option a live `--hd-text-scale` multiplier corresponds to. */
export function toTextScaleValue(scale: number): TextScaleValue {
  if (Math.abs(scale - 1.3) < 0.001) return "1.3";
  if (Math.abs(scale - 1.15) < 0.001) return "1.15";
  return "1";
}

/**
 * Put a text size into effect, everywhere it is read.
 *
 * Three places, and all three matter: the CSS variable is what every
 * `text-hd-*` step multiplies by; `hd:text-scale` tells `useTextScale()`
 * readers (the virtual list's row heights) to re-measure; and localStorage is
 * what the inline script in `app/layout.tsx` reads before first paint, so a
 * reload does not flash the page at 1x.
 */
export function applyTextScale(value: TextScaleValue): void {
  document.documentElement.style.setProperty("--hd-text-scale", value);
  emit("text-scale");
  // Best-effort: without it a reload paints at 1x until Dexie is read.
  safeSetItem("local", "hd-text-scale", value);
}

export interface TextScalePreference {
  /** The size currently in effect. */
  textScale: TextScaleValue;
  /** Apply, persist to Dexie, and announce with a toast. */
  setTextScale: (value: TextScaleValue) => Promise<void>;
  /** Normal → Large → Extra Large → Normal (the mobile menu's single button). */
  cycleTextScale: () => void;
}

/**
 * The user's text-size preference: read at mount from Dexie, written back on
 * change.
 *
 * The *current* value is not kept in state here. It is derived from
 * `useTextScale()`, which reads the live CSS variable and follows
 * `hd:text-scale` — so the menu's checkmark reports what is actually applied,
 * and there is one reader of `--hd-text-scale` rather than two.
 */
export function useTextScalePreference(): TextScalePreference {
  const textScale = toTextScaleValue(useTextScale());

  // Dexie is the durable copy; localStorage is only the pre-paint mirror.
  useEffect(() => {
    getPreference("text-scale").then((v) => {
      if (v === "1.15" || v === "1.3") applyTextScale(v);
    });
  }, []);

  const setTextScale = useCallback(async (value: TextScaleValue) => {
    applyTextScale(value);
    await setPreference("text-scale", value);
    const label = TEXT_SCALE_OPTIONS.find((o) => o.value === value)?.label ?? value;
    toast.info(`Text size: ${label}`);
  }, []);

  const cycleTextScale = useCallback(() => {
    const next: TextScaleValue = textScale === "1" ? "1.15" : textScale === "1.15" ? "1.3" : "1";
    void setTextScale(next);
  }, [textScale, setTextScale]);

  return { textScale, setTextScale, cycleTextScale };
}
