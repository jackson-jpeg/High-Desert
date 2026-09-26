"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import { formatAirDate } from "@/lib/utils/format";
import { formatLength, formatStationTime } from "@/lib/live/format";
import type { ProgramSlot } from "@/lib/live/schedule";
import { OnAirLamp } from "./OnAirLamp";

export type GuideState = "past" | "now" | "future";

/** Where a slot stands at `t`: aired, on the air, or still to come. */
export function guideState(slot: Pick<ProgramSlot, "start" | "end">, t: number): GuideState {
  if (t >= slot.end) return "past";
  if (t >= slot.start) return "now";
  return "future";
}

export const KIND_LABEL: Record<ProgramSlot["kind"], string> = {
  "on-this-date": "On this date",
  "fan-favorite": "Fan favorite",
  "outage-swap": "From the mirror",
};

/**
 * Bring the on-air row into view inside the log's own box, and nowhere else.
 * `scrollIntoView` scrolls every scrolling ancestor: on a phone the box grows
 * to fit its rows, so it scrolled the page instead, and the Studio opened with
 * the clock, the live count and Now playing above the top of the screen.
 * The box is the list's parent; the sticky heading before the list is allowed for.
 */
export function revealInGuideBox(list: HTMLElement, row: HTMLElement): void {
  const box = list.parentElement;
  if (!box || box.scrollHeight <= box.clientHeight) return;
  const heading = list.previousElementSibling instanceof HTMLElement ? list.previousElementSibling.offsetHeight : 0;
  const r = row.getBoundingClientRect();
  const c = box.getBoundingClientRect();
  if (r.top < c.top + heading) box.scrollTop += r.top - c.top - heading;
  else if (r.bottom > c.bottom) box.scrollTop += r.bottom - c.bottom;
}

/**
 * Today's program, as a station log: time (Pacific), show, guest, length.
 * What has aired is in the dim tier, what is on is lit, what is coming is
 * primary text. The row on the air is brought into view in the log's own box
 * when the guide mounts (`revealInGuideBox`), never by scrolling the page.
 */
export function ProgramGuide({ slots, now }: { slots: readonly ProgramSlot[]; now: number }) {
  const listRef = useRef<HTMLOListElement>(null);
  const onAirRef = useRef<HTMLLIElement>(null);
  const onAirKey = slots.find((s) => guideState(s, now) === "now")?.start;
  useEffect(() => {
    if (listRef.current && onAirRef.current) revealInGuideBox(listRef.current, onAirRef.current);
  }, [onAirKey]);

  return (
    <ol ref={listRef} data-testid="live-guide" className="flex flex-col" aria-label="Today's program">
      {slots.map((slot) => {
        const state = guideState(slot, now);
        return (
          <li
            key={`${slot.start}:${slot.fileHash}`}
            ref={state === "now" ? onAirRef : undefined}
            data-state={state}
            aria-current={state === "now" ? "true" : undefined}
            className={cn(
              "grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-2 py-1.5",
              "border-b border-bevel-dark/15 last:border-b-0",
              state === "now" && "bg-inset-well",
            )}
          >
            <span
              className={cn(
                "text-hd-caption tabular-nums w98-font",
                state === "now" ? "text-phosphor-amber" : state === "past" ? "text-bevel-dark/85" : "text-bevel-dark",
              )}
            >
              {formatStationTime(slot.start)}
            </span>
            <span className="flex flex-col min-w-0">
              <span
                className={cn(
                  "text-hd-body truncate",
                  state === "past" ? "text-bevel-dark/85" : "text-desktop-gray",
                  state === "now" && "text-desert-amber",
                )}
              >
                {slot.title}
              </span>
              <span className={cn("text-hd-micro truncate", state === "past" ? "text-bevel-dark/85" : "text-bevel-dark")}>
                {[slot.guestName, slot.airDate ? formatAirDate(slot.airDate) : null, KIND_LABEL[slot.kind]]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span className="flex items-center gap-2 text-hd-micro tabular-nums text-bevel-dark/85">
              {state === "now" ? <OnAirLamp lit size="sm" /> : formatLength((slot.end - slot.start) / 1000)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
