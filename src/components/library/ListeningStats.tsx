"use client";

import { useState, useEffect, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { cn } from "@/lib/utils/cn";
import { fetchActiveCount } from "@/services/stats/client";
import { computeStreak } from "@/lib/utils/streak";

interface ListeningStatsProps {
  className?: string;
}

export function ListeningStats({ className }: ListeningStatsProps) {
  const history = useLiveQuery(() => db.history.toArray(), []);
  const episodes = useLiveQuery(() => db.episodes.toArray(), []);

  const [activeCount, setActiveCount] = useState(0);

  useEffect(() => {
    fetchActiveCount().then(setActiveCount);
    const interval = setInterval(() => {
      fetchActiveCount().then(setActiveCount);
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const stats = useMemo(() => {
    if (!history || !episodes) return null;

    const streak = computeStreak(history);

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

  if (!stats || (stats.streak === 0 && stats.hours === 0 && !stats.topGuest)) return null;

  return (
    <div className={cn(
      "w98-inset-dark bg-inset-well px-3 py-2 md:py-1.5 flex flex-wrap items-center gap-3 md:gap-4 text-hd-11 md:text-hd-9",
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
        <span className="text-desktop-gray/85 truncate">
          👤 Most played: <span className="text-static-green/85">{stats.topGuest}</span>
        </span>
      )}
      {activeCount > 0 && (
        <span className="text-desktop-gray/85">
          👥 {activeCount} listening now
        </span>
      )}
    </div>
  );
}
