"use client";

import { useCallback } from "react";

/**
 * Marks a sideways-scrolling row with which edges have more behind them:
 * `data-more-left` and `data-more-right` on the element itself, kept current
 * on scroll, on resize and when its children change, with no React render.
 * src/styles/scroll-edges.css fades only those edges (`.hd-scroll-edges`), so
 * a cut chip reads as "more this way" and the fade goes once the row is
 * scrolled to its end.
 *
 * A callback ref (`ref={useScrollEdges()}`), not an effect on a ref object:
 * the category chips mount empty and fill in from the database later, and an
 * effect that measured once at mount never saw them (2026-11-27).
 *
 * The Library's category chips and show tabs were cut mid-word at 390
 * ("Psychology & Cons", "Speci") with nothing to say the row scrolls
 * (docs/UI-PLAN.md, push 1).
 */
export function useScrollEdges(): (el: HTMLElement | null) => (() => void) | void {
  return useCallback((el: HTMLElement | null) => {
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
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, []);
}
