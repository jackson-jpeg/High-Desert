"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { scrubberIndexAt, type RailGroup } from "@/lib/library/rail-groups";

interface YearScrubberProps {
  /** From `deriveRailGroups()` over the rendered list — the same groups the desktop rail draws. */
  groups: readonly RailGroup[];
  /** Index into `groups` of the group holding the first visible row, or -1. */
  activeIndex: number;
  /** True while the list is scrolling (and for a moment after). */
  awake: boolean;
  onSelect: (group: RailGroup) => void;
  /** Called when a drag ends, so the owner can keep the scrubber up for its idle period. */
  onRelease: () => void;
  className?: string;
}

const YEAR = /^\d{4}$/;

/**
 * The phone's rail: a slim scrubber down the right edge, like the iOS Photos
 * one. It appears while the list scrolls, fades when it stops, and dragging
 * down it jumps the list group by group with a bubble naming the group under
 * the finger.
 *
 * It is the desktop rail's projection with a different body: the same
 * `deriveRailGroups()` output, in the same order, so top of the scrubber is top
 * of the list in every sort (docs/timeline-rail.md). Labels sit in equal
 * slots, so the slot under the finger (`scrubberIndexAt`) is the label under
 * it.
 *
 * The track is slim; the hit area is a full touch width. While hidden it takes
 * no pointer events, so the cards' right edge stays tappable.
 */
export function YearScrubber({ groups, activeIndex, awake, onSelect, onRelease, className }: YearScrubberProps) {
  const trackRef = useRef<HTMLElement>(null);
  const [dragIndex, setDragIndex] = useState(-1);
  const lastPicked = useRef(-1);

  if (groups.length === 0) return null;

  const dragging = dragIndex >= 0;
  const shown = awake || dragging;

  const pick = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const i = scrubberIndexAt(clientY, r.top, r.height, groups.length);
    if (i < 0) return;
    setDragIndex(i);
    // Only scroll when the finger crosses into a new group: a pointermove per
    // pixel would otherwise re-issue the same scroll dozens of times.
    if (i !== lastPicked.current) {
      lastPicked.current = i;
      onSelect(groups[i]);
    }
  };

  const release = () => {
    lastPicked.current = -1;
    setDragIndex(-1);
    onRelease();
  };

  const bubble = dragging ? groups[dragIndex] : null;

  return (
    <div
      data-testid="year-scrubber"
      data-visible={shown ? "true" : "false"}
      className={cn(
        "absolute right-0 top-0 bottom-0 z-20 w-touch min-w-touch py-3 flex justify-end",
        "transition-[opacity,visibility] duration-300 motion-reduce:transition-none",
        shown ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none",
        className,
      )}
    >
      {bubble && (
        <div
          data-testid="year-scrubber-bubble"
          aria-hidden="true"
          className="absolute right-[52px] -translate-y-1/2 glass-heavy rounded-lg px-3 py-1.5 whitespace-nowrap pointer-events-none text-hd-h3 text-desert-amber font-bold tabular-nums"
          style={{ top: `calc(0.75rem + (100% - 1.5rem) * ${(dragIndex + 0.5) / groups.length})` }}
        >
          {bubble.title}
        </div>
      )}
      {/* The track. `touch-none` keeps a drag here from also panning the list.
          Type size is on the track, not the entries — `cn()` (tailwind-merge)
          drops a `text-hd-*` size that shares a class list with a text colour. */}
      <nav
        ref={trackRef}
        aria-label="Jump to"
        className="relative h-full w-full flex flex-col touch-none select-none text-hd-micro"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          pick(e.clientY);
        }}
        onPointerMove={(e) => {
          if (dragging) pick(e.clientY);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        {/* The slim visible body, behind the labels. */}
        <div aria-hidden="true" className="absolute right-[4px] top-0 bottom-0 w-[36px] glass-medium rounded-full" />
        {groups.map((g, i) => {
          const active = i === activeIndex;
          return (
            <button
              key={g.key}
              type="button"
              tabIndex={shown ? 0 : -1}
              data-group={g.key}
              data-year={YEAR.test(g.key) ? g.key : undefined}
              aria-current={active ? "true" : undefined}
              aria-label={`${g.title}, ${g.count} episode${g.count === 1 ? "" : "s"}`}
              onClick={() => onSelect(g)}
              className={cn(
                "relative flex-1 min-h-0 flex items-center justify-end pr-[6px] tabular-nums leading-none",
                active ? "text-desert-amber font-bold" : "text-desktop-gray/85",
              )}
            >
              <span className="w-[32px] text-center">{g.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
