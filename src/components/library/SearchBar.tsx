"use client";

import { forwardRef } from "react";
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
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <TextField
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search episodes..."
          className="flex-1"
        />
        {resultCount !== undefined && (
          <span className="text-[10px] text-bevel-dark whitespace-nowrap">
            {resultCount} {resultCount === 1 ? "result" : "results"}
          </span>
        )}
      </div>
    );
  },
);
