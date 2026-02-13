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
          <TextField
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Search episodes... (try guest: year: tag:)"
            className="flex-1"
          />
          {resultCount !== undefined && (
            <span className="text-[10px] text-bevel-dark whitespace-nowrap">
              {resultCount} {resultCount === 1 ? "result" : "results"}
            </span>
          )}
          <button
            onClick={() => setShowHelp(!showHelp)}
            className={cn(
              "text-[10px] cursor-pointer transition-colors-fast flex-shrink-0 hidden md:inline",
              showHelp ? "text-desert-amber" : "text-bevel-dark/40 hover:text-bevel-dark",
            )}
            title="Search syntax help"
          >
            ?
          </button>
        </div>
        {showHelp && (
          <div className="text-[8px] text-bevel-dark/60 flex flex-wrap gap-x-3 gap-y-0.5 px-1">
            <span><span className="text-desert-amber/70">guest:</span>name</span>
            <span><span className="text-desert-amber/70">year:</span>1997</span>
            <span><span className="text-desert-amber/70">tag:</span>ufo</span>
            <span><span className="text-desert-amber/70">show:</span>coast</span>
            <span><span className="text-desert-amber/70">has:</span>favorite</span>
            <span><span className="text-desert-amber/70">has:</span>bookmark</span>
            <span><span className="text-desert-amber/70">has:</span>played</span>
          </div>
        )}
      </div>
    );
  },
);
