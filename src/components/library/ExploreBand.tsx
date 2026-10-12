"use client";

import type { Episode } from "@/db/schema";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { RecentlyPlayed } from "@/components/library/RecentlyPlayed";
import { OnThisDay } from "@/components/library/OnThisDay";
import { cn } from "@/lib/utils/cn";

/**
 * The collapsible Explore band: above the list on a desktop, under it on a
 * phone (where the first screen is for the shows). Collapsed by default. Continue Listening used to
 * live in here, collapsed by default; it is now its own card at the top of
 * the Library (ContinueListening), where a returning listener lands.
 */
export function ExploreBand({
  expanded,
  onToggle,
  recentlyPlayed,
  onPlay,
  below = false,
}: {
  expanded: boolean;
  onToggle: () => void;
  recentlyPlayed: Episode[] | undefined;
  onPlay: (episode: Episode) => void;
  /** Under the list (a phone): a slim bar with a rule above it. */
  below?: boolean;
}) {
  return (
    <div className={cn("px-3 flex-shrink-0", below && "border-t border-bevel-dark/15")} data-testid="explore-band" data-below={below || undefined}>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="text-hd-13 md:text-hd-10 text-bevel-dark uppercase tracking-wider px-2 py-2 md:px-1 md:py-0.5 min-h-touch md:min-h-0 cursor-pointer hover:text-desktop-gray active:text-desktop-gray transition-colors-fast"
      >
        {expanded ? "▾" : "▸"} Explore
      </button>

      {expanded && (
        <div className="flex flex-col gap-1 mt-1 mb-1">
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
