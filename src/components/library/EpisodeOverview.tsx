"use client";

import type { Episode } from "@/db/schema";
import { formatDuration, formatAirDate } from "@/lib/utils/format";
import { emit } from "@/lib/events";

/**
 * The read-only top of the detail panel: title, air date, length, community
 * plays, guest (or topic), series chip, summary and tags. Guest, series and
 * tags are filters, fired on the typed bus.
 */
export function EpisodeOverview({ episode, communityPlays }: { episode: Episode; communityPlays?: number }) {
  return (
    <>
      {/* Title + date + duration */}
      <div>
        <div className="text-hd-h3 md:text-hd-body text-desktop-gray font-bold leading-snug break-words font-sans">
          {episode.title || episode.fileName}
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          {episode.airDate && (
            <span className="text-hd-body md:text-hd-caption text-desert-amber tabular-nums font-mono tracking-tight">
              {formatAirDate(episode.airDate)}
            </span>
          )}
          {episode.duration != null && (
            <span className="text-hd-body md:text-hd-caption text-bevel-dark/85 tabular-nums font-mono">
              {formatDuration(episode.duration)}
            </span>
          )}
          {communityPlays != null && communityPlays > 0 && (
            <span className="text-hd-caption md:text-hd-micro text-bevel-dark/85">
              ▶ {communityPlays.toLocaleString()} community plays
            </span>
          )}
        </div>
      </div>

      {/* Guest */}
      {episode.guestName && (
        <div
          className="text-hd-title md:text-hd-body text-static-green/85 hover:text-static-green hover:underline cursor-pointer w-fit"
          onClick={() => {
            if (episode.guestName) emit("show-guest", episode.guestName);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (episode.guestName) emit("show-guest", episode.guestName);
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={`View guest profile: ${episode.guestName}`}
        >
          {episode.guestName}
        </div>
      )}

      {/* Topic */}
      {episode.topic && !episode.guestName && (
        <div className="text-hd-title md:text-hd-body text-desktop-gray/85">
          {episode.topic}
        </div>
      )}

      {/* Series */}
      {episode.aiSeries && (
        <button
          onClick={() => {
            if (episode.aiSeries) emit("filter-series", episode.aiSeries);
          }}
          className="text-hd-body md:text-hd-caption text-signal-blue bg-title-bar-blue/8 px-2 py-1 md:px-1.5 md:py-px cursor-pointer hover:text-signal-blue hover:bg-title-bar-blue/15 active:text-signal-blue active:bg-title-bar-blue/15 transition-colors-fast flex items-center gap-1 w-fit"
          title={`Filter by ${episode.aiSeries}`}
        >
          <span>{"\u{1F4DA}"}</span>
          <span>
            {episode.aiSeries}
            {episode.aiSeriesPart ? ` — Part ${episode.aiSeriesPart}` : ""}
          </span>
        </button>
      )}

      {/* Summary or Description */}
      {(episode.aiSummary || episode.description) && (
        <div className="text-hd-title md:text-hd-caption text-desktop-gray/85 leading-relaxed font-sans">
          {episode.aiSummary || episode.description}
        </div>
      )}

      {/* Tags (clickable) */}
      {episode.aiTags && episode.aiTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {episode.aiTags.map((tag) => (
            <button
              key={tag}
              onClick={() => {
                emit("filter-tag", tag);
              }}
              className="text-hd-body md:text-hd-caption text-desert-amber/85 bg-desert-amber/10 border border-desert-amber/15 px-2.5 py-1.5 md:px-1.5 md:py-px rounded-sm cursor-pointer hover:bg-desert-amber/20 hover:text-desert-amber active:bg-desert-amber/20 active:text-desert-amber transition-colors-fast"
              title={`Filter by "${tag}"`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
