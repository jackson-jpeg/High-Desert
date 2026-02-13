"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";

interface MoreLikeThisProps {
  episode: Episode;
  onPlay: (episode: Episode) => void;
  className?: string;
}

export function MoreLikeThis({ episode, onPlay, className }: MoreLikeThisProps) {
  const allEpisodes = useLiveQuery(
    () => db.episodes.toArray(),
    [],
  );

  const recommendations = useMemo(() => {
    if (!allEpisodes || allEpisodes.length < 2) return [];

    const tags = new Set(episode.aiTags ?? []);
    const scores = new Map<number, number>();

    for (const ep of allEpisodes) {
      if (ep.id === episode.id) continue;

      let score = 0;

      // Same guest = strong signal
      if (episode.guestName && ep.guestName === episode.guestName) {
        score += 5;
      }

      // Same topic
      if (episode.topic && ep.topic === episode.topic) {
        score += 3;
      }

      // Shared tags
      if (ep.aiTags && tags.size > 0) {
        for (const tag of ep.aiTags) {
          if (tags.has(tag)) score += 1;
        }
      }

      // Same show type (small bonus)
      if (episode.showType && ep.showType === episode.showType && episode.showType !== "unknown") {
        score += 0.5;
      }

      // Close in time (within 30 days)
      if (episode.airDate && ep.airDate) {
        const d1 = new Date(episode.airDate).getTime();
        const d2 = new Date(ep.airDate).getTime();
        const dayDiff = Math.abs(d1 - d2) / 86400000;
        if (dayDiff < 7) score += 1;
        else if (dayDiff < 30) score += 0.5;
      }

      if (score > 0) {
        scores.set(ep.id!, score);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => allEpisodes.find((ep) => ep.id === id)!)
      .filter(Boolean);
  }, [allEpisodes, episode]);

  if (recommendations.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="text-[8px] text-desert-amber uppercase tracking-wider font-bold">
        More Like This
      </div>
      {recommendations.map((ep) => (
        <button
          key={ep.id}
          onClick={() => onPlay(ep)}
          className="flex items-center gap-2 text-left px-1 py-1 cursor-pointer hover:bg-title-bar-blue/10 transition-colors-fast"
        >
          <div className="flex-1 min-w-0">
            <div className="text-[9px] text-desktop-gray/80 truncate">
              {ep.title || ep.fileName}
            </div>
            {ep.guestName && (
              <div className="text-[7px] text-static-green/50 truncate">
                {ep.guestName}
              </div>
            )}
          </div>
          {ep.airDate && (
            <span className="text-[7px] text-bevel-dark/40 tabular-nums flex-shrink-0">
              {ep.airDate}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
