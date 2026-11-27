"use client";

import type { HistoryEntry } from "@/db/schema";
import { db } from "@/db";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";
import { emit } from "@/lib/events";
import { groupListens, LISTEN_MIN_S } from "@/lib/stats/listens";
import { formatHeard } from "@/lib/stats/format-heard";

interface HistoryPanelProps {
  /** Every history row, as /stats read them: the panel and the tiles read one set. */
  rows: HistoryEntry[];
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

/** How many lines the panel lists; the rest are counted, not drawn. */
export const HISTORY_SHOWN = 50;

/**
 * Listening History (UI plan push 6, batch 2): one line per show, newest
 * first, "played 5 times" where it was, and only real listens
 * (src/lib/stats/listens.ts). It read the newest 50 raw rows and folded only
 * back-to-back repeats, so one show restored on five visits read as five
 * lines, none of which anybody heard.
 */
export function HistoryPanel({ rows, className }: HistoryPanelProps) {
  const groups = groupListens(rows);

  const play = async (episodeId: number) => {
    const episode = await db.episodes.get(episodeId);
    if (episode) emit("play-episode", episode);
  };

  if (groups.length === 0) {
    return (
      <Window title="Listening History" variant="dark" headingLevel={2} className={className}>
        <div className="p-4 text-hd-caption text-bevel-dark" data-testid="history-empty">
          Shows you listen to for a minute or more show up here.
        </div>
      </Window>
    );
  }

  // By the day of each show's newest listen.
  const days = new Map<string, typeof groups>();
  for (const g of groups.slice(0, HISTORY_SHOWN)) {
    const day = new Date(g.last).toLocaleDateString();
    days.set(day, [...(days.get(day) ?? []), g]);
  }
  const today = new Date().toLocaleDateString();

  return (
    <Window title="Listening History" variant="dark" headingLevel={2} className={className}>
      <div className="p-3 flex flex-col gap-3 max-h-[400px] overflow-auto overscroll-contain" data-testid="history-list" data-min-seconds={LISTEN_MIN_S}>
        {[...days.entries()].map(([day, list]) => (
          <div key={day}>
            <div className="text-hd-10 md:text-hd-8 text-desert-amber uppercase tracking-wider mb-1.5 font-bold">
              {day === today ? "Today" : day}
            </div>
            <div className="flex flex-col gap-1">
              {list.map((g) => (
                <button
                  key={g.episodeId}
                  type="button"
                  onClick={() => play(g.episodeId)}
                  data-history-show={g.episodeId}
                  data-plays={g.plays}
                  className={cn(
                    "flex items-center gap-2 text-left px-2.5 py-2 md:py-1.5 w98-raised-dark bg-card-surface min-h-touch md:min-h-0",
                    "cursor-pointer hover:bg-title-bar-blue/15 active:bg-title-bar-blue/20 transition-colors-fast",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-hd-12 md:text-hd-10 text-desktop-gray truncate">{g.episodeTitle}</div>
                    <div className="text-hd-10 md:text-hd-8 text-bevel-dark truncate">
                      {g.guestName && <span className="text-static-green">{g.guestName} · </span>}
                      {g.plays > 1 ? `played ${g.plays} times, ` : ""}
                      {formatHeard(g.seconds)} heard
                    </div>
                  </div>
                  <span className="text-hd-9 md:text-hd-8 text-bevel-dark/85 tabular-nums flex-shrink-0">
                    {formatRelativeTime(g.last)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length > HISTORY_SHOWN && (
          <div className="text-hd-caption text-bevel-dark">
            and {(groups.length - HISTORY_SHOWN).toLocaleString()} more shows heard before these.
          </div>
        )}
      </div>
    </Window>
  );
}
