"use client";

import { TextField } from "@/components/win98";
import { cn } from "@/lib/utils/cn";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  resultCount?: number;
  className?: string;
}

export function SearchBar({
  value,
  onChange,
  resultCount,
  className,
}: SearchBarProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <TextField
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
}
