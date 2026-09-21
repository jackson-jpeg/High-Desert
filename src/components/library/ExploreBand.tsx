"use client";

import type { Episode } from "@/db/schema";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { ContinueListening } from "@/components/library/ContinueListening";
import { RecentlyPlayed } from "@/components/library/RecentlyPlayed";
import { OnThisDay } from "@/components/library/OnThisDay";

/**
 * The collapsible Explore band above the list. Continue Listening lives in
 * here — it is discovery content, and as its own always-on band it was one
 * more strip of chrome between the search box and the first episode.
 */
export function ExploreBand({
  expanded,
  onToggle,
  recentlyPlayed,
  onPlay,
}: {
  expanded: boolean;
  onToggle: () => void;
  recentlyPlayed: Episode[] | undefined;
  onPlay: (episode: Episode) => void;
}) {
  return (
    <div className="px-3 flex-shrink-0">
      <button
        onClick={onToggle}
        className="text-hd-13 md:text-hd-10 text-bevel-dark uppercase tracking-wider px-2 py-2 md:px-1 md:py-0.5 cursor-pointer hover:text-desktop-gray active:text-desktop-gray transition-colors-fast"
      >
        {expanded ? "▾" : "▸"} Explore
      </button>

      {expanded && (
        <div className="flex flex-col gap-1 mt-1 mb-1">
          <WidgetErrorBoundary name="Continue Listening">
            <ContinueListening onPlay={onPlay} />
          </WidgetErrorBoundary>
          <div className="flex flex-col md:flex-row gap-2 overflow-hidden max-h-[200px] md:max-h-[100px]">
            {recentlyPlayed && recentlyPlayed.length > 0 && (
              <WidgetErrorBoundary name="Recently Played">
                <RecentlyPlayed episodes={recentlyPlayed.slice(0, 4)} onPlay={onPlay} compact />
              </WidgetErrorBoundary>
            )}
            <WidgetErrorBoundary name="On This Day">
              <OnThisDay onPlay={onPlay} compact className="md:w-[220px] md:flex-shrink-0" />
            </WidgetErrorBoundary>
          </div>
        </div>
      )}
    </div>
  );
}
