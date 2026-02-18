"use client";

import { forwardRef, useState } from "react";
import { TextField } from "@/components/win98";
import { cn } from "@/lib/utils/cn";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  resultCount?: number;
  className?: string;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  function SearchBar({ value, onChange, resultCount, className }, ref) {
    const [showHelp, setShowHelp] = useState(false);

    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <TextField
              ref={ref}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Search episodes... (try guest: year: tag:)"
              className="w-full"
            />
            {value && (
              <button
                onClick={() => onChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] md:text-[9px] text-bevel-dark/50 hover:text-desktop-gray active:text-desktop-gray cursor-pointer min-w-[24px] min-h-[24px] flex items-center justify-center"
                aria-label="Clear search"
              >
                {"\u2715"}
              </button>
            )}
          </div>
          {resultCount !== undefined && (
            <span className="text-[11px] md:text-[10px] text-bevel-dark whitespace-nowrap tabular-nums">
              {resultCount}
            </span>
          )}
          <button
            onClick={() => setShowHelp(!showHelp)}
            className={cn(
              "text-[12px] md:text-[10px] cursor-pointer transition-colors-fast flex-shrink-0 min-w-[32px] min-h-[32px] md:min-w-0 md:min-h-0 flex items-center justify-center",
              showHelp ? "text-desert-amber" : "text-bevel-dark/40 hover:text-bevel-dark active:text-bevel-dark",
            )}
            title="Search syntax help"
          >
            ?
          </button>
        </div>
        {showHelp && (
          <div className="text-[10px] md:text-[8px] text-bevel-dark/60 flex flex-wrap gap-x-3 gap-y-1 md:gap-y-0.5 px-1 py-1 md:py-0 w98-inset-dark bg-inset-well/50 md:bg-transparent md:border-0">
            <span><span className="text-desert-amber/70">guest:</span>name</span>
            <span><span className="text-desert-amber/70">year:</span>1997</span>
            <span><span className="text-desert-amber/70">tag:</span>ufo</span>
            <span><span className="text-desert-amber/70">show:</span>coast</span>
            <span><span className="text-desert-amber/70">cat:</span>paranormal</span>
            <span><span className="text-desert-amber/70">series:</span>name</span>
            <span><span className="text-desert-amber/70">has:</span>favorite</span>
            <span><span className="text-desert-amber/70">has:</span>notable</span>
            <span><span className="text-desert-amber/70">has:</span>bookmark</span>
            <span><span className="text-desert-amber/70">has:</span>played</span>
          </div>
        )}
      </div>
    );
  },
);
