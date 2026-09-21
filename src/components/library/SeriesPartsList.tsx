"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { cn } from "@/lib/utils/cn";
import { formatAirDate } from "@/lib/utils/format";
import { sortSeriesParts } from "@/lib/library/episode-detail";

/** Every part of the episode's series, in part order; hidden for a one-part series. */
export function SeriesPartsList({ seriesName, currentEpisodeId, onPlay }: { seriesName: string; currentEpisodeId?: number; onPlay: (ep: Episode) => void }) {
  const parts = useLiveQuery(
    () => db.episodes.where("aiSeries").equals(seriesName).toArray(),
    [seriesName],
  );

  if (!parts || parts.length < 2) return null;

  const sorted = sortSeriesParts(parts);

  return (
    <div className="border-t border-bevel-dark/15 glass-divider pt-2 mt-0.5">
      <div className="text-hd-body md:text-hd-caption text-signal-blue uppercase tracking-wider mb-1.5 font-bold">
        Series ({sorted.length} parts)
      </div>
      <div className="flex flex-col gap-0.5">
        {sorted.map((ep) => {
          const isCurrent = ep.id === currentEpisodeId;
          return (
            <button
              key={ep.id}
              onClick={() => { if (!isCurrent) onPlay(ep); }}
              className={cn(
                "text-left px-2 py-1.5 md:px-1.5 md:py-1 text-hd-body md:text-hd-caption cursor-pointer transition-colors-fast flex items-center gap-2 min-h-[36px] md:min-h-0",
                isCurrent
                  ? "bg-title-bar-blue/15 text-signal-blue"
                  : "text-desktop-gray/85 hover:text-desktop-gray hover:bg-title-bar-blue/10 active:bg-title-bar-blue/15",
              )}
            >
              {ep.aiSeriesPart && (
                <span className="text-hd-caption md:text-hd-caption text-signal-blue w-[20px] flex-shrink-0 tabular-nums">
                  Pt.{ep.aiSeriesPart}
                </span>
              )}
              <span className="truncate flex-1">{ep.title || ep.fileName}</span>
              {ep.airDate && (
                <span className="text-hd-caption md:text-hd-caption text-bevel-dark/85 flex-shrink-0 tabular-nums">
                  {formatAirDate(ep.airDate)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
