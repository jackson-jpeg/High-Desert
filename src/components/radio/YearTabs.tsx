"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The radio's year quick-jump bar, as an ARIA tablist with the tabs keyboard
 * pattern: Left/Right move to the previous/next year and tune to it
 * (automatic activation — a year is cheap to jump to), Home/End go to the
 * first/last, and only the current year's tab is in the Tab order (roving
 * tabindex).
 *
 * It was `role="tablist"` with `role="tab"` buttons and no key handling. The
 * key-ownership guard (HD-011) rightly gives a tablist its own arrows — that
 * is the tabs contract — so the dial's window handler stood aside and, after
 * clicking a year, the arrows did nothing at all.
 */
export function YearTabs({
  years,
  currentYear,
  isMobile,
  onSelect,
}: {
  years: number[];
  /** The year the dial is tuned to; its tab is the selected one. */
  currentYear: number | null;
  isMobile: boolean;
  onSelect: (year: number) => void;
}) {
  const tabRefs = useRef(new Map<number, HTMLButtonElement>());
  // The tab in the Tab order: the selected year, or the first before the
  // dial has a position.
  const rovingYear = currentYear !== null && years.includes(currentYear) ? currentYear : years[0];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const focused = years.findIndex((y) => tabRefs.current.get(y) === document.activeElement);
    const from = focused !== -1 ? focused : years.indexOf(rovingYear);
    let next: number;
    switch (e.key) {
      case "ArrowRight":
        next = (from + 1) % years.length;
        break;
      case "ArrowLeft":
        next = (from - 1 + years.length) % years.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = years.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const year = years[next];
    onSelect(year);
    tabRefs.current.get(year)?.focus();
  };

  return (
    <div
      className="flex items-center gap-0 md:gap-0.5 overflow-x-auto pb-0.5"
      role="tablist"
      aria-label="Jump to year"
      onKeyDown={handleKeyDown}
    >
      {years.map((year) => {
        const isCurrentYear = year === currentYear;
        // Mobile fades years by their distance from the tuned one. It went
        // down to 15% opacity — text at roughly 1.3:1 — and is floored at the
        // /85 text ramp now (HD-023); distance past a couple of years shows
        // in colour instead, amber stepping down to the secondary grey.
        const dist = currentYear ? Math.abs(year - currentYear) : 0;
        const mobileOpacity = Math.max(0.85, 1 - dist * 0.05);
        const far = isMobile && currentYear !== null && dist > 2;

        return (
          <button
            key={year}
            ref={(el) => {
              if (el) tabRefs.current.set(year, el);
              else tabRefs.current.delete(year);
            }}
            onClick={() => onSelect(year)}
            className={cn(
              "md:text-hd-8 md:px-1.5 md:py-0.5 md:min-h-0 hover:text-desert-amber active:text-desert-amber cursor-pointer transition-colors-fast whitespace-nowrap flex-shrink-0",
              far ? "text-bevel-dark md:text-desert-amber" : "text-desert-amber",
              // Mobile: monospace abbreviated years
              "text-hd-9 px-[7px] py-2 min-h-touch font-mono tracking-wide",
              isCurrentYear && "font-bold md:font-normal",
            )}
            style={isMobile ? {
              opacity: mobileOpacity,
              textShadow: isCurrentYear ? "0 0 8px rgba(212,168,67,0.3)" : "none",
            } : undefined}
            role="tab"
            aria-selected={isCurrentYear}
            tabIndex={year === rovingYear ? 0 : -1}
            aria-label={`Jump to ${year}`}
            data-year={year}
          >
            <span className="md:hidden">&rsquo;{String(year).slice(2)}</span>
            <span className="hidden md:inline">{year}</span>
          </button>
        );
      })}
    </div>
  );
}
