"use client";

import { useState } from "react";
import type { Episode } from "@/db/schema";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { RecentlyPlayed } from "@/components/library/RecentlyPlayed";
import { OnThisDay } from "@/components/library/OnThisDay";
import { SmartPlaylists } from "@/components/library/SmartPlaylists";
import { TopicIndex } from "@/components/library/TopicIndex";
import { cn } from "@/lib/utils/cn";

/**
 * The collapsible Explore band: above the list on a desktop, under it on a
 * phone (where the first screen is for the shows). Collapsed by default.
 * Expanded: recently played, On this date, then Smart Playlists and the
 * Topic Index (moved here from /stats, 2026-11-27). Continue Listening used to
 * live in here, collapsed by default; it is now its own card at the top of
 * the Library (ContinueListening), where a returning listener lands.
 */
type ExploreView = "today" | "playlists" | "topics";
const EXPLORE_VIEWS: [ExploreView, string][] = [
  ["today", "On this date"],
  ["playlists", "Smart Playlists"],
  ["topics", "Topics"],
];

export function ExploreBand({
  expanded,
  onToggle,
  recentlyPlayed,
  onPlay,
  episodes,
  below = false,
}: {
  expanded: boolean;
  onToggle: () => void;
  recentlyPlayed: Episode[] | undefined;
  onPlay: (episode: Episode) => void;
  /** The library, for the Topic Index. */
  episodes?: Episode[];
  /** Under the list (a phone): a slim bar with a rule above it. */
  below?: boolean;
}) {
  const [view, setView] = useState<ExploreView>("today");
  return (
    <div className={cn("px-3 flex-shrink-0", below && "border-t border-bevel-dark/15")} data-testid="explore-band" data-below={below || undefined}>
      {/* The view switches share the toggle's row: Explore open takes no more
          height than it did before batch 3. */}
      <div className="flex flex-wrap items-center gap-x-3">
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="text-hd-13 md:text-hd-10 text-bevel-dark uppercase tracking-wider px-2 py-2 md:px-1 md:py-0.5 min-h-touch md:min-h-0 cursor-pointer hover:text-desktop-gray active:text-desktop-gray transition-colors-fast"
        >
          {expanded ? "▾" : "▸"} Explore
        </button>
        {expanded && (
          <div className="flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label="Explore">
            {EXPLORE_VIEWS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                data-explore-view={key}
                onClick={() => setView(key)}
                className={cn(
                  "text-hd-12 md:text-hd-10 px-1 min-h-touch md:min-h-0 cursor-pointer underline-offset-2",
                  view === key ? "text-desert-amber underline" : "text-bevel-dark hover:text-desktop-gray",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <div className="flex flex-col gap-1 mt-1 mb-1">
          {/* One view at a time in one short area, so the list keeps its room
              (Smart Playlists and the Topic Index came from /stats, UI plan
              push 6, batch 3; drawn together they pushed the list off a
              900 px screen). */}
          <div className="max-h-[200px] md:max-h-[100px] overflow-auto overscroll-contain" data-testid="explore-more" data-view={view}>
            {view === "today" && (
              <div className="flex flex-col md:flex-row gap-2">
                {recentlyPlayed && recentlyPlayed.length > 0 && (
                  <WidgetErrorBoundary name="Recently Played">
                    <RecentlyPlayed episodes={recentlyPlayed.slice(0, 4)} onPlay={onPlay} compact />
                  </WidgetErrorBoundary>
                )}
                <WidgetErrorBoundary name="On This Day">
                  <OnThisDay onPlay={onPlay} compact className="md:w-[220px] md:flex-shrink-0" />
                </WidgetErrorBoundary>
              </div>
            )}
            {view === "playlists" && (
              <WidgetErrorBoundary name="Smart Playlists">
                <SmartPlaylists onPlay={onPlay} />
              </WidgetErrorBoundary>
            )}
            {view === "topics" && (
              <WidgetErrorBoundary name="Topic Index">
                <TopicIndex episodes={episodes} />
              </WidgetErrorBoundary>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
