"use client";

import type { Episode } from "@/lib/db/schema";
import { EpisodeCard } from "./EpisodeCard";
import { cn } from "@/lib/utils/cn";

interface TimelineViewProps {
  episodes: Episode[];
  currentEpisodeId?: number;
  onEpisodeClick: (episode: Episode) => void;
  className?: string;
}

interface YearGroup {
  year: string;
  episodes: Episode[];
}

function groupByYear(episodes: Episode[]): YearGroup[] {
  const groups = new Map<string, Episode[]>();

  for (const ep of episodes) {
    const year = ep.airDate ? ep.airDate.slice(0, 4) : "Unknown";
    const list = groups.get(year) ?? [];
    list.push(ep);
    groups.set(year, list);
  }

  // Sort years descending
  return Array.from(groups.entries())
    .sort(([a], [b]) => (b === "Unknown" ? -1 : a === "Unknown" ? 1 : b.localeCompare(a)))
    .map(([year, episodes]) => ({ year, episodes }));
}

export function TimelineView({
  episodes,
  currentEpisodeId,
  onEpisodeClick,
  className,
}: TimelineViewProps) {
  const groups = groupByYear(episodes);

  if (episodes.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
        <div className="text-[14px] text-bevel-dark mb-2">No episodes found</div>
        <div className="text-[11px] text-bevel-dark">
          Use Library &rarr; Scan Folder to add episodes
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {groups.map(({ year, episodes: yearEpisodes }) => (
        <div key={year}>
          {/* Sticky year header */}
          <div className="sticky top-0 z-10 bg-midnight/95 backdrop-blur-sm px-4 py-2 border-b border-bevel-dark/20">
            <span className="text-[12px] text-desert-amber font-bold">
              {year}
            </span>
            <span className="text-[10px] text-bevel-dark ml-2">
              ({yearEpisodes.length} episodes)
            </span>
          </div>

          {/* Episode cards */}
          <div className="flex flex-col gap-1 p-2">
            {yearEpisodes.map((ep) => (
              <EpisodeCard
                key={ep.id}
                episode={ep}
                isPlaying={ep.id === currentEpisodeId}
                onClick={onEpisodeClick}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
