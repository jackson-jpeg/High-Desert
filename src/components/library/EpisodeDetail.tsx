"use client";

import type { Episode } from "@/lib/db/schema";
import { Button } from "@/components/win98";
import { cn } from "@/lib/utils/cn";

interface EpisodeDetailProps {
  episode: Episode;
  isPlaying: boolean;
  onPlay: (episode: Episode) => void;
  onClose: () => void;
  className?: string;
}

export function EpisodeDetail({
  episode,
  isPlaying,
  onPlay,
  onClose,
  className,
}: EpisodeDetailProps) {
  const showLabel =
    episode.showType === "coast"
      ? "Coast to Coast AM"
      : episode.showType === "dreamland"
        ? "Dreamland"
        : episode.showType === "special"
          ? "Special"
          : null;

  const isArchive = episode.source === "archive";

  return (
    <div
      className={cn(
        "w98-raised-dark bg-raised-surface flex flex-col animate-slide-up",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bevel-dark/20">
        <div className="flex items-center gap-2 min-w-0">
          {showLabel && (
            <span className="text-[9px] text-bevel-dark uppercase tracking-wider flex-shrink-0">
              {showLabel}
            </span>
          )}
          {isArchive && (
            <span className="text-[8px] text-title-bar-blue bg-title-bar-blue/15 px-1.5 py-px uppercase tracking-wider flex-shrink-0">
              Archive
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-[10px] text-bevel-dark hover:text-desktop-gray cursor-pointer flex-shrink-0 ml-2"
          aria-label="Close detail"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-3 overflow-auto">
        {/* Title + date */}
        <div>
          <div className="text-[12px] text-desktop-gray font-bold leading-snug">
            {episode.title || episode.fileName}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {episode.airDate && (
              <span className="text-[10px] text-desert-amber tabular-nums">
                {episode.airDate}
              </span>
            )}
            {episode.duration != null && (
              <span className="text-[10px] text-bevel-dark tabular-nums">
                {formatDuration(episode.duration)}
              </span>
            )}
          </div>
        </div>

        {/* Guest */}
        {episode.guestName && (
          <div>
            <div className="text-[9px] text-bevel-dark uppercase tracking-wider mb-0.5">
              Guest
            </div>
            <div className="text-[11px] text-static-green">
              {episode.guestName}
            </div>
          </div>
        )}

        {/* Topic */}
        {episode.topic && (
          <div>
            <div className="text-[9px] text-bevel-dark uppercase tracking-wider mb-0.5">
              Topic
            </div>
            <div className="text-[11px] text-desktop-gray">
              {episode.topic}
            </div>
          </div>
        )}

        {/* AI Summary */}
        {episode.aiSummary && (
          <div>
            <div className="text-[9px] text-bevel-dark uppercase tracking-wider mb-0.5">
              Summary
            </div>
            <div className="text-[10px] text-desktop-gray/80 leading-relaxed">
              {episode.aiSummary}
            </div>
          </div>
        )}

        {/* AI Tags */}
        {episode.aiTags && episode.aiTags.length > 0 && (
          <div>
            <div className="text-[9px] text-bevel-dark uppercase tracking-wider mb-1">
              Tags
            </div>
            <div className="flex flex-wrap gap-1">
              {episode.aiTags.map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] text-desert-amber/80 bg-desert-amber/10 px-1.5 py-px"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Play button */}
        <div className="pt-1">
          <Button
            variant="dark"
            size="sm"
            onClick={() => onPlay(episode)}
            disabled={isPlaying}
          >
            {isPlaying ? "Playing" : "Play"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}
