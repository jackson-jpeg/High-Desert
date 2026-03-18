"use client";

import { cn } from "@/lib/utils/cn";

interface YearNavigatorProps {
  years: [string, number][]; // [year, count]
  currentYear: string | null;
  onYearClick: (year: string) => void;
  className?: string;
}

export function YearNavigator({ years, currentYear, onYearClick, className }: YearNavigatorProps) {
  if (years.length === 0) return null;

  return (
    <div
      className={cn(
        "hidden md:flex flex-col items-center justify-center gap-[2px] w-[44px] flex-shrink-0 sticky top-0 h-full overflow-auto py-2",
        className,
      )}
    >
      {years.map(([year, count], i) => {
        const prevYear = i > 0 ? years[i - 1][0] : null;
        const isDecadeBoundary = prevYear && year.slice(0, 3) !== prevYear.slice(0, 3);
        return (
          <button
            key={year}
            onClick={() => onYearClick(year)}
            className={cn(
              "text-hd-9 tabular-nums leading-tight px-1 py-[1px] cursor-pointer transition-colors-fast w-full text-center",
              year === currentYear
                ? "text-desert-amber bg-desert-amber/10 font-bold"
                : "text-bevel-dark/50 hover:text-desktop-gray hover:bg-title-bar-blue/10",
              i % 2 === 1 && year !== currentYear && "bg-white/[0.02]",
              isDecadeBoundary && "mt-1.5 border-t border-bevel-dark/15 pt-1",
            )}
            title={`${year} (${count} episodes)`}
          >
            <div>{year.slice(2)}</div>
            <div className="text-hd-8 opacity-60">{count}</div>
          </button>
        );
      })}
    </div>
  );
}
