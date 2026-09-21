"use client";

import type { Episode } from "@/db/schema";
import { getShowLabel } from "@/lib/utils/format";
import { emit } from "@/lib/events";

/** Show · source line, the category chip, the notable mark, and the close button. */
export function EpisodeDetailHeader({ episode, onClose }: { episode: Episode; onClose: () => void }) {
  const showLabel = getShowLabel(episode.showType);
  const isArchive = episode.source === "archive";

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-bevel-dark/20 glass-divider">
      <div className="flex items-center gap-1.5">
        <span className="text-hd-body md:text-hd-caption text-bevel-dark/85">
          {[showLabel, isArchive ? "Archive" : null].filter(Boolean).join(" · ")}
        </span>
        {episode.aiCategory && (
          <button
            onClick={() => {
              if (episode.aiCategory) emit("filter-category", episode.aiCategory);
            }}
            className="text-hd-body md:text-hd-caption text-desert-amber/85 bg-desert-amber/8 px-2 py-1 md:px-1 md:py-px cursor-pointer hover:text-desert-amber hover:bg-desert-amber/15 active:text-desert-amber active:bg-desert-amber/15 transition-colors-fast"
            title={`Filter by ${episode.aiCategory}`}
          >
            {episode.aiCategory}
          </button>
        )}
        {episode.aiNotable && (
          <span className="text-hd-body md:text-hd-caption text-yellow-400" title="Notable episode">
            {"✪"}
          </span>
        )}
      </div>
      <button
        onClick={onClose}
        className="text-hd-title md:text-hd-caption text-bevel-dark hover:text-desktop-gray active:text-desktop-gray cursor-pointer flex-shrink-0 min-w-touch min-h-touch md:min-w-0 md:min-h-0 flex items-center justify-center"
        aria-label="Close detail"
      >
        {"✕"}
      </button>
    </div>
  );
}
