"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import type { RailGroup } from "@/lib/library/rail-groups";

interface YearNavigatorProps {
  /** From `deriveRailGroups()` over the rendered list — top to bottom, as the list runs. */
  groups: readonly RailGroup[];
  /** Index into `groups` of the group holding the first visible row, or -1. */
  activeIndex: number;
  onSelect: (group: RailGroup) => void;
  className?: string;
}

const YEAR = /^\d{4}$/;

/**
 * The library rail. It draws `groups` in the order given and nothing else: it
 * does not sort, count or filter, because every time it did it disagreed with
 * the list beside it (docs/timeline-rail.md). Years in date order, initials in
 * name/guest order, rating and play-count buckets — all the same component.
 *
 * Shown at every width. On a phone each entry is a full 44px touch target and
 * the rail scrolls on its own, keeping the active entry in view; it narrows the
 * cards by its width rather than covering them.
 */
export function YearNavigator({ groups, activeIndex, onSelect, className }: YearNavigatorProps) {
  const railRef = useRef<HTMLElement>(null);

  // Keep the active entry inside the rail's own viewport. Adjusts the rail's
  // scrollTop directly: scrollIntoView() would also scroll every scrollable
  // ancestor, the page included.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || activeIndex < 0) return;
    const el = rail.querySelector<HTMLElement>(`[data-rail-index="${activeIndex}"]`);
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < rail.scrollTop) rail.scrollTop = top;
    else if (bottom > rail.scrollTop + rail.clientHeight) rail.scrollTop = bottom - rail.clientHeight;
  }, [activeIndex, groups]);

  if (groups.length === 0) return null;

  return (
    <nav
      ref={railRef}
      data-testid="year-rail"
      aria-label="Jump to"
      className={cn(
        // `relative` makes the rail the entries' offsetParent (see the effect).
        // `my-auto` on the inner column centres a short rail and collapses to
        // zero on a long one, so the top entries are never clipped the way
        // `justify-center` on an overflowing column clips them.
        "relative flex flex-col w-[44px] min-w-touch flex-shrink-0 h-full overflow-y-auto overscroll-contain py-1",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {/* Type size is set here, not on the entries: `cn()` is tailwind-merge,
          which does not know `text-hd-*` is a font size and drops it as a
          conflicting colour when an entry's `text-<colour>` follows it. */}
      <div className="my-auto flex flex-col gap-[2px] text-hd-caption">
        {groups.map((g, i) => {
          const active = i === activeIndex;
          const prev = i > 0 ? groups[i - 1].key : null;
          const isDecadeBoundary = prev !== null && YEAR.test(prev) && YEAR.test(g.key) && prev.slice(0, 3) !== g.key.slice(0, 3);
          return (
            <button
              key={g.key}
              type="button"
              data-group={g.key}
              data-year={YEAR.test(g.key) ? g.key : undefined}
              data-rail-index={i}
              aria-current={active ? "true" : undefined}
              aria-label={`${g.title}, ${g.count} episode${g.count === 1 ? "" : "s"}`}
              title={`${g.title} (${g.count} episode${g.count === 1 ? "" : "s"})`}
              onClick={() => onSelect(g)}
              className={cn(
                "flex flex-col items-center justify-center w-full min-h-touch md:min-h-0 px-1 py-[2px]",
                "tabular-nums cursor-pointer transition-colors-fast text-center",
                active
                  ? "text-desert-amber bg-desert-amber/10 font-bold"
                  : "text-bevel-dark/85 hover:text-desktop-gray hover:bg-title-bar-blue/10",
                i % 2 === 1 && !active && "bg-white/[0.02]",
                isDecadeBoundary && "mt-1.5 border-t border-bevel-dark/15 pt-1",
              )}
            >
              <span>{g.label}</span>
              <span className="text-hd-micro leading-none font-normal">
                {g.count}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
