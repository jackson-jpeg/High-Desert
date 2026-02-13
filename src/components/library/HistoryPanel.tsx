"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { HistoryEntry } from "@/lib/db/schema";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";

interface HistoryPanelProps {
  onPlayEpisode?: (episodeId: number) => void;
  className?: string;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function HistoryPanel({ onPlayEpisode, className }: HistoryPanelProps) {
  const entries = useLiveQuery(
    () => db.history.orderBy("timestamp").reverse().limit(50).toArray(),
    [],
  );

  if (!entries || entries.length === 0) {
    return null;
  }

  // Group by day
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const day = new Date(entry.timestamp).toLocaleDateString();
    const group = groups.get(day) ?? [];
    group.push(entry);
    groups.set(day, group);
  }

  const handleClick = async (entry: HistoryEntry) => {
    if (!onPlayEpisode) return;
    const episode = await db.episodes.get(entry.episodeId);
    if (episode) {
      window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: episode }));
    }
  };

  return (
    <Window title="Listening History" variant="dark" className={className}>
      <div className="p-3 flex flex-col gap-3 max-h-[400px] overflow-auto">
        {Array.from(groups.entries()).map(([day, dayEntries]) => (
          <div key={day}>
            <div className="text-[8px] text-desert-amber/60 uppercase tracking-wider mb-1.5 font-bold">
              {day === new Date().toLocaleDateString() ? "Today" : day}
            </div>
            <div className="flex flex-col gap-1">
              {dayEntries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => handleClick(entry)}
                  className={cn(
                    "flex items-center gap-2 text-left px-2 py-1.5 w98-raised-dark bg-card-surface",
                    "cursor-pointer hover:bg-title-bar-blue/15 transition-colors-fast",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-desktop-gray truncate">
                      {entry.episodeTitle}
                    </div>
                    {entry.guestName && (
                      <div className="text-[8px] text-static-green/60 truncate">
                        {entry.guestName}
                      </div>
                    )}
                  </div>
                  <span className="text-[8px] text-bevel-dark/50 tabular-nums flex-shrink-0">
                    {formatRelativeTime(entry.timestamp)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Window>
  );
}
