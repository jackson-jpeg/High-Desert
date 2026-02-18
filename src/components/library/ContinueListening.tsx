"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";

interface ContinueListeningProps {
  onPlay: (episode: Episode) => void;
  className?: string;
}

export function ContinueListening({ onPlay, className }: ContinueListeningProps) {
  const [dismissed, setDismissed] = useState(false);
  const playing = usePlayerStore((s) => s.playing);

  // Get in-progress episodes: >10% and <90% progress, sorted by lastPlayedAt desc
  const inProgress = useLiveQuery(async () => {
    const eps = await db.episodes
      .where("lastPlayedAt")
      .above(0)
      .reverse()
      .sortBy("lastPlayedAt");

    return eps
      .filter((ep) => {
        if (!ep.duration || !ep.playbackPosition) return false;
        const pct = ep.playbackPosition / ep.duration;
        return pct > 0.1 && pct < 0.9;
      })
      .slice(0, 5); // fetch up to 5, display limited by CSS
  }, []);

  // Auto-hide when something starts playing
  useEffect(() => {
    if (playing) setDismissed(true);
  }, [playing]);

  if (dismissed || !inProgress || inProgress.length === 0) return null;

  return (
    <div className={cn("w98-raised-dark bg-raised-surface animate-slide-up", className)}>
      <div className="px-3 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] text-bevel-dark/60 uppercase tracking-wider">
            Continue Listening
          </span>
          <button
            onClick={() => setDismissed(true)}
            className="text-[9px] text-bevel-dark hover:text-desktop-gray cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto">
          {inProgress.slice(0, 3).map((ep, i) => {
            const pct = ep.duration && ep.playbackPosition
              ? Math.round((ep.playbackPosition / ep.duration) * 100)
              : 0;
            return (
              <button
                key={ep.id}
                onClick={() => onPlay(ep)}
                className={cn(
                  "flex-shrink-0 w-[200px] md:w-[180px] p-2 w98-raised-dark bg-card-surface hover:bg-title-bar-blue/15 cursor-pointer transition-colors-fast text-left",
                  i >= 2 && "hidden md:block",
                )}
              >
                <div className="text-[11px] md:text-[10px] text-desktop-gray font-bold truncate">
                  {ep.title || ep.fileName}
                </div>
                {ep.guestName && (
                  <div className="text-[9px] text-static-green/60 truncate mt-0.5">
                    {ep.guestName}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-[3px] w98-inset-dark bg-inset-well overflow-hidden">
                    <div
                      className="h-full bg-phosphor-amber/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[8px] text-bevel-dark tabular-nums">{pct}%</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
