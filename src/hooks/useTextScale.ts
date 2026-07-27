"use client";

import { useEffect, useState } from "react";

/**
 * The user's text-size multiplier (`--hd-text-scale`), as a number.
 *
 * Anything that hard-codes a pixel height for text content has to scale with
 * this. The virtual list is the load-bearing case: its row slots are a fixed
 * pixel height, so at 1.3x the card content outgrew its slot by ~23px and rows
 * visibly overlapped. That was latent until the type scale started compiling —
 * the multiplier previously fed variables no utility ever read.
 */
export function useTextScale(): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const read = () => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--hd-text-scale")
        .trim();
      const n = Number.parseFloat(raw);
      setScale(Number.isFinite(n) && n > 0 ? n : 1);
    };

    read();
    window.addEventListener("hd:text-scale", read);
    return () => window.removeEventListener("hd:text-scale", read);
  }, []);

  return scale;
}

/**
 * Row heights for the episode virtual list, in CSS px at scale 1.
 *
 * Single source of truth: these were previously duplicated across three call
 * sites with three different values (110/76, 88/72, 92/76), which put
 * scroll-to-current 22px per row out on mobile — ~11,000px adrift by index 500.
 */
export const ITEM_HEIGHT_MOBILE = 116; // mobile stacks date/title/category/guest
export const ITEM_HEIGHT_DESKTOP = 34; // desktop is a single aligned table row

/** Row height for the current breakpoint and text scale. */
export function itemHeightFor(isMobile: boolean, scale: number): number {
  return Math.round((isMobile ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT_DESKTOP) * scale);
}

/**
 * Imperative equivalent of `itemHeightFor` for use inside effects and event
 * handlers, where hooks aren't available. Reads the live breakpoint and scale.
 */
export function currentItemHeight(): number {
  if (typeof window === "undefined") return ITEM_HEIGHT_DESKTOP;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--hd-text-scale")
    .trim();
  const scale = Number.parseFloat(raw);
  return itemHeightFor(
    window.innerWidth < 768,
    Number.isFinite(scale) && scale > 0 ? scale : 1,
  );
}
