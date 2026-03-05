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
        "hidden md:flex flex-col items-center justify-center gap-[2px] w-[40px] flex-shrink-0 sticky top-0 h-full overflow-auto py-2",
        className,
      )}
    >
      {years.map(([year, count]) => (
        <button
          key={year}
          onClick={() => onYearClick(year)}
          className={cn(
            "text-[9px] tabular-nums leading-tight px-1 py-[1px] cursor-pointer transition-colors-fast w-full text-center",
            year === currentYear
              ? "text-desert-amber bg-desert-amber/10 font-bold"
              : "text-bevel-dark/50 hover:text-desktop-gray hover:bg-title-bar-blue/10",
          )}
          title={`${year} (${count} episodes)`}
        >
          <div>{year.slice(2)}</div>
          <div className="text-[8px] opacity-60">{count}</div>
        </button>
      ))}
    </div>
  );
}
