"use client";

import { useEffect, type RefObject } from "react";

/**
 * Marks a sideways-scrolling row with which edges have more behind them:
 * `data-more-left` and `data-more-right` on the element itself, kept current
 * on scroll and resize, with no React render. src/styles/scroll-edges.css
 * fades only those edges (`.hd-scroll-edges`), so a cut chip reads as "more
 * this way" and the fade goes once the row is scrolled to its end.
 *
 * The Library's category chips and show tabs were cut mid-word at 390
 * ("Psychology & Cons", "Speci") with nothing to say the row scrolls
 * (docs/UI-PLAN.md, push 1).
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.toggleAttribute("data-more-left", el.scrollLeft > 1);
      el.toggleAttribute("data-more-right", max - el.scrollLeft > 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [ref]);
}
