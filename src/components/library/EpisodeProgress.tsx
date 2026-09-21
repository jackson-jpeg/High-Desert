"use client";

import type { Episode } from "@/db/schema";
import { cn } from "@/lib/utils/cn";
import { formatDuration, formatTime } from "@/lib/utils/format";
import { formatPlayStats, playbackProgress } from "@/lib/library/episode-detail";

/** Saved position as a bar with "12:34 / 3:00:00", then the play-stats line. */
export function EpisodeProgress({ episode }: { episode: Episode }) {
  const progress = playbackProgress(episode);
  return (
    <>
      {progress && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-[3px] w98-inset-dark bg-inset-well overflow-hidden">
            <div
              className={cn(
                "h-full",
                progress.nearlyDone ? "bg-static-green/50" : "bg-phosphor-amber/50",
              )}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="text-hd-body md:text-hd-caption text-bevel-dark/85 tabular-nums flex-shrink-0">
            {formatTime(episode.playbackPosition!)} / {formatDuration(episode.duration!)}
          </span>
        </div>
      )}

      {(episode.playCount ?? 0) > 0 && <PlayStats episode={episode} />}
    </>
  );
}

function PlayStats({ episode }: { episode: Episode }) {
  const text = formatPlayStats(episode);
  if (!text) return null;
  return (
    <div className="text-hd-body md:text-hd-caption text-bevel-dark/85 tabular-nums">
      {text}
    </div>
  );
}
