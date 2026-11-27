"use client";

import { useEffect } from "react";

/** Which of the guide's slots is on the air at `now`: the index, or -1. */
export function onAirIndex(slots: readonly { start: number; end: number }[], now: number): number {
  return slots.findIndex((s) => s.start <= now && now < s.end);
}

/**
 * Lights the show on the air in the program guide (docs/UI-PLAN.md, push 5).
 * The page is server HTML cached until the next deploy, so the light is set
 * here, from the browser's clock, and moves once a minute. Without
 * JavaScript the guide simply has no light.
 */
export function OnAirMarker({ listId }: { listId: string }) {
  useEffect(() => {
    const mark = () => {
      const list = document.getElementById(listId);
      if (!list) return;
      const rows = [...list.querySelectorAll<HTMLElement>("[data-slot-start]")];
      const slots = rows.map((r) => ({ start: Number(r.dataset.slotStart), end: Number(r.dataset.slotEnd) }));
      const lit = onAirIndex(slots, Date.now());
      rows.forEach((r, i) => r.toggleAttribute("data-on-air", i === lit));
    };
    mark();
    const id = setInterval(mark, 60_000);
    return () => clearInterval(id);
  }, [listId]);
  return null;
}
