"use client";

import { useMemo, useState, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";

interface OnThisDayProps {
  onPlay: (episode: Episode) => void;
  compact?: boolean;
  className?: string;
}

export function OnThisDay({ onPlay, compact, className }: OnThisDayProps) {
  const [monthDay, setMonthDay] = useState<string | null>(null);
  const [monthName, setMonthName] = useState("");
  useEffect(() => {
    const now = new Date();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe: null on SSR, computed once on client
    setMonthDay(`${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
    setMonthName(now.toLocaleDateString("en-US", { month: "long", day: "numeric" }));
  }, []);

  const allEpisodes = useLiveQuery(
    () => monthDay ? db.episodes.where("airDate").above("").toArray() : Promise.resolve([] as Episode[]),
    [monthDay],
  );

  const matches = useMemo(() => {
    if (!allEpisodes || !monthDay) return [];
    const sorted = allEpisodes
      .filter((ep) => ep.airDate?.slice(5) === monthDay)
      .sort((a, b) => (a.airDate ?? "").localeCompare(b.airDate ?? ""));
    return compact ? sorted.slice(0, 3) : sorted;
  }, [allEpisodes, monthDay, compact]);

  if (!monthDay) {
    return (
      <div className={cn("flex flex-col gap-0.5", className)}>
        <span className="text-[8px] text-bevel-dark/70 uppercase tracking-wider px-1">Loading...</span>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className={cn("flex flex-col gap-0.5", className)}>
        <span className="text-[8px] text-bevel-dark/70 uppercase tracking-wider px-1">{monthName}</span>
        <div className="text-[9px] text-desktop-gray/60 px-1.5 py-1">No episodes found for this day</div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cn("flex flex-col gap-0.5", className)}>
        <span className="text-[8px] text-bevel-dark/70 uppercase tracking-wider px-1">{monthName}</span>
        {matches.map((ep) => {
          const year = ep.airDate?.slice(0, 4);
          return (
            <button
              key={ep.id}
              onClick={() => onPlay(ep)}
              className="flex items-center gap-1.5 text-left px-1.5 py-1 w98-raised-dark bg-card-surface cursor-pointer hover:bg-title-bar-blue/15 transition-colors-fast"
            >
              <span className="text-[8px] text-desert-amber tabular-nums">{year}</span>
              <span className="text-[9px] text-desktop-gray truncate flex-1">{ep.title || ep.fileName}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Window title={`On This Day \u00B7 ${monthName}`} variant="dark" className={className}>
      <div className="p-2 flex flex-col gap-1 max-h-[200px] md:max-h-[120px] overflow-auto">
        {matches.map((ep) => {
          const year = ep.airDate?.slice(0, 4);
          return (
            <button
              key={ep.id}
              onClick={() => onPlay(ep)}
              className={cn(
                "flex items-center gap-2 text-left px-2.5 py-2 md:py-1.5 w98-raised-dark bg-card-surface min-h-[44px] md:min-h-0",
                "cursor-pointer hover:bg-title-bar-blue/15 active:bg-title-bar-blue/20 transition-colors-fast",
              )}
            >
              <span className="text-[10px] text-desert-amber tabular-nums w-[32px] flex-shrink-0">{year}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-desktop-gray truncate">{ep.title || ep.fileName}</div>
                {ep.guestName && <div className="text-[10px] md:text-[8px] text-static-green/60 truncate">{ep.guestName}</div>}
              </div>
              {ep.showType && ep.showType !== "unknown" && (
                <span className="text-[9px] md:text-[7px] text-bevel-dark/50 flex-shrink-0 uppercase">
                  {ep.showType === "coast" ? "C2C" : ep.showType === "dreamland" ? "DL" : "SP"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Window>
  );
}
