"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { cn } from "@/lib/utils/cn";

interface ListeningStatsProps {
  className?: string;
}

export function ListeningStats({ className }: ListeningStatsProps) {
  const history = useLiveQuery(() => db.history.toArray(), []);
  const episodes = useLiveQuery(() => db.episodes.toArray(), []);

  const stats = useMemo(() => {
    if (!history || !episodes) return null;

    // Listening streak
    let streak = 0;
    const daySet = new Set<string>();
    for (const entry of history) {
      daySet.add(new Date(entry.timestamp).toISOString().slice(0, 10));
    }
    const today = new Date();
    for (let d = 0; d < 365; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() - d);
      const key = date.toISOString().slice(0, 10);
      if (daySet.has(key)) {
        streak++;
      } else if (d === 0) {
        continue;
      } else {
        break;
      }
    }

    // Total listening time from history durations
    const totalSeconds = history.reduce((sum, h) => sum + (h.duration ?? 0), 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    // Most played guest
    const guestPlays = new Map<string, number>();
    for (const h of history) {
      if (h.guestName) {
        guestPlays.set(h.guestName, (guestPlays.get(h.guestName) ?? 0) + 1);
      }
    }
    let topGuest = "";
    let topCount = 0;
    for (const [g, c] of guestPlays) {
      if (c > topCount) { topGuest = g; topCount = c; }
    }

    return { streak, hours, minutes, topGuest };
  }, [history, episodes]);

  if (!history || !episodes) {
    return (
      <div className={cn(
        "w98-inset-dark bg-inset-well px-3 py-2 md:py-1.5 flex items-center justify-center text-[11px] md:text-[9px] text-bevel-dark/60",
        className,
      )}>
        <div className="animate-spin w-3 h-3 border-1 border-static-green/60 border-t-transparent rounded-full mr-2" />
        Loading listening stats…
      </div>
    );
  }

  if (stats.streak === 0 && stats.hours === 0 && !stats.topGuest) {
    return (
      <div className={cn(
        "w98-inset-dark bg-inset-well px-3 py-2 md:py-1.5 flex items-center justify-center text-[11px] md:text-[9px] text-bevel-dark/60",
        className,
      )}>
        No listening data yet — start an episode to see stats
      </div>
    );
  }

  return (
    <div className={cn(
      "w98-inset-dark bg-inset-well px-3 py-2 md:py-1.5 flex flex-wrap items-center gap-3 md:gap-4 text-[11px] md:text-[9px]",
      className,
    )}>
      {stats.streak > 0 && (
        <span className="text-static-green">
          🔥 Streak: <span className="font-bold">{stats.streak}d</span>
        </span>
      )}
      {(stats.hours > 0 || stats.minutes > 0) && (
        <span className="text-desert-amber">
          ⏱ {stats.hours}h {stats.minutes}m listened
        </span>
      )}
      {stats.topGuest && (
        <span className="text-desktop-gray/70 truncate">
          👤 Most played: <span className="text-static-green/80">{stats.topGuest}</span>
        </span>
      )}
    </div>
  );
}
