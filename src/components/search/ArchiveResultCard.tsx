"use client";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/win98";
import type { ArchiveSearchResult } from "@/lib/archive/types";

interface ArchiveResultCardProps {
  result: ArchiveSearchResult;
  isAdding: boolean;
  isAdded: boolean;
  onAdd: (result: ArchiveSearchResult) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ArchiveResultCard({
  result,
  isAdding,
  isAdded,
  onAdd,
  className,
  style,
}: ArchiveResultCardProps) {
  const date = result.date?.substring(0, 10);

  // Strip HTML tags from description
  const description = result.description
    ? result.description.replace(/<[^>]*>/g, "").substring(0, 200)
    : null;

  return (
    <div
      style={style}
      className={cn(
        "p-3 w98-raised-dark bg-card-surface flex flex-col gap-1",
        "hover:bg-title-bar-blue/10 transition-colors-fast",
        className,
      )}
    >
      {/* Top row: date + downloads */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-desert-amber tabular-nums">
          {date ?? "Unknown date"}
        </span>
        {result.downloads != null && (
          <span className="text-[9px] text-bevel-dark tabular-nums">
            {result.downloads.toLocaleString()} dl
          </span>
        )}
      </div>

      {/* Title */}
      <div className="text-[11px] text-desktop-gray font-bold truncate">
        {result.title}
      </div>

      {/* Description */}
      {description && (
        <div className="text-[10px] text-bevel-dark line-clamp-2 leading-relaxed">
          {description}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px] text-bevel-dark truncate">
          {result.creator ?? "Art Bell"}
        </span>
        <div className="transition-state">
          {isAdded ? (
            <span className="text-[10px] text-static-green/80">
              Added
            </span>
          ) : (
            <Button
              size="sm"
              variant="dark"
              onClick={() => onAdd(result)}
              disabled={isAdding}
            >
              {isAdding ? "..." : "Add"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
