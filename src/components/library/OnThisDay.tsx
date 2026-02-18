"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";

interface OnThisDayProps {
  onPlay: (episode: Episode) => void;
  className?: string;
}

export function OnThisDay({ onPlay, className }: OnThisDayProps) {
  const now = new Date();
  const monthDay = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const allEpisodes = useLiveQuery(
    () => db.episodes.where("airDate").above("").toArray(),
    [],
  );

  const matches = useMemo(() => {
    if (!allEpisodes) return [];
    return allEpisodes
      .filter((ep) => ep.airDate?.slice(5) === monthDay)
      .sort((a, b) => (a.airDate ?? "").localeCompare(b.airDate ?? ""));
  }, [allEpisodes, monthDay]);

  if (matches.length === 0) return null;

  const monthName = now.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return (
    <Window title={`On This Day \u00B7 ${monthName}`} variant="dark" className={className}>
      <div className="p-2 flex flex-col gap-1 max-h-[200px] overflow-auto">
        {matches.map((ep) => {
          const year = ep.airDate?.slice(0, 4);
          return (
            <button
              key={ep.id}
              onClick={() => onPlay(ep)}
              className={cn(
                "flex items-center gap-2 text-left px-2 py-1.5 w98-raised-dark bg-card-surface",
                "cursor-pointer hover:bg-title-bar-blue/15 transition-colors-fast",
              )}
            >
              <span className="text-[10px] text-desert-amber tabular-nums w-[32px] flex-shrink-0">
                {year}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-desktop-gray truncate">
                  {ep.title || ep.fileName}
                </div>
                {ep.guestName && (
                  <div className="text-[8px] text-static-green/60 truncate">
                    {ep.guestName}
                  </div>
                )}
              </div>
              {ep.showType && ep.showType !== "unknown" && (
                <span className="text-[7px] text-bevel-dark/50 flex-shrink-0 uppercase">
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
