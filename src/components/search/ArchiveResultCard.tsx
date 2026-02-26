"use client";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/win98";
import type { ArchiveSearchResult } from "@/services/archive/types";
import { useLongPress } from "@/hooks/useLongPress";

interface ArchiveResultCardProps {
  result: ArchiveSearchResult;
  isAdding: boolean;
  isAdded: boolean;
  onAdd: (result: ArchiveSearchResult) => void;
  onContextMenu?: (result: ArchiveSearchResult, x: number, y: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ArchiveResultCard({
  result,
  isAdding,
  isAdded,
  onAdd,
  onContextMenu,
  className,
  style,
}: ArchiveResultCardProps) {
  // Validate required metadata
  const hasValidTitle = result.title && result.title.trim().length > 0;
  const hasValidDate = result.date && result.date.trim().length > 0;
  const hasValidCreator = result.creator && result.creator.trim().length > 0;

  const date = hasValidDate ? result.date.substring(0, 10) : null;

  // Strip HTML tags from description
  const description = result.description
    ? result.description.replace(/<[^>]*>/g, "").substring(0, 200)
    : null;

  const handleContextMenu = (e: React.MouseEvent) => {
    if (onContextMenu) {
      e.preventDefault();
      onContextMenu(result, e.clientX, e.clientY);
    }
  };

  const longPress = useLongPress((e) => {
    if (onContextMenu) {
      const touch = e.touches[0];
      onContextMenu(result, touch?.clientX ?? 0, touch?.clientY ?? 0);
    }
  });

  return (
    <div
      style={style}
      onContextMenu={handleContextMenu}
      {...longPress}
      className={cn(
        "p-3 w98-raised-dark bg-card-surface flex flex-col gap-1",
        "hover:bg-title-bar-blue/10 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)] active:bg-title-bar-blue/15",
        "transition-all duration-150 cursor-default",
        className,
      )}
    >
      {/* Top row: date + downloads */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] md:text-[10px] text-desert-amber tabular-nums">
          {date ?? "Unknown date"}
        </span>
        {result.downloads != null && (
          <span className="text-[11px] md:text-[9px] text-bevel-dark tabular-nums">
            {result.downloads.toLocaleString()} dl
          </span>
        )}
      </div>

      {/* Title */}
      <div className="text-[13px] md:text-[11px] text-desktop-gray font-bold truncate">
        {hasValidTitle ? result.title : "Untitled Episode"}
      </div>

      {/* Description */}
      {description && (
        <div className="text-[12px] md:text-[10px] text-bevel-dark/70 line-clamp-2 leading-relaxed">
          {description}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center justify-between mt-0.5">
        <span className="text-[11px] md:text-[9px] text-bevel-dark/60 truncate">
          {hasValidCreator ? result.creator : "Unknown Host"}
        </span>
        <div className="transition-state">
          {isAdded ? (
            <span className="text-[12px] md:text-[10px] text-static-green/80 flex items-center gap-1">
              <span>{"\u2713"}</span> Added
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
