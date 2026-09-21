"use client";

import { cn } from "@/lib/utils/cn";

/**
 * The library's browse-by-facet sidebar — guests, categories, series, topics.
 * Desktop only; the page decides whether it is open.
 */
export function FacetSidebar({
  topGuests,
  categoryCounts,
  seriesCounts,
  topTopics,
  guestFilter,
  setGuestFilter,
  categoryFilter,
  setCategoryFilter,
  seriesFilter,
  setSeriesFilter,
  onTopic,
}: {
  topGuests: [string, number][];
  categoryCounts: Map<string, number>;
  seriesCounts: Map<string, number>;
  topTopics: [string, number][];
  guestFilter: string | null;
  setGuestFilter: (guest: string | null) => void;
  categoryFilter: string | null;
  setCategoryFilter: (cat: string | null) => void;
  seriesFilter: string | null;
  setSeriesFilter: (series: string | null) => void;
  /** A topic is a free-text search, not a filter. */
  onTopic: (topic: string) => void;
}) {
  return (
    <div className="hidden md:flex w-[180px] flex-shrink-0 overflow-auto border-r border-bevel-dark/20 p-2 flex-col gap-3">
      {/* Top Guests */}
      {topGuests.length > 0 && (
        <div>
          <div className="text-hd-10 text-desert-amber uppercase tracking-wider mb-1.5 font-bold">
            Guests
          </div>
          <div className="flex flex-col gap-0.5">
            {topGuests.map(([guest, count]) => (
              <button
                key={guest}
                onClick={() => setGuestFilter(guestFilter === guest ? null : guest)}
                className={`
                  text-left px-1.5 py-0.5 text-hd-10 cursor-pointer transition-colors-fast truncate
                  ${guestFilter === guest
                    ? "bg-title-bar-blue/20 text-desktop-gray"
                    : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10"
                  }
                `}
              >
                {guest}
                <span className="ml-1 tabular-nums text-bevel-dark/85">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Categories */}
      {categoryCounts.size > 0 && (
        <div>
          <div className="text-hd-10 text-desert-amber uppercase tracking-wider mb-1.5 font-bold">
            Categories
          </div>
          <div className="flex flex-col gap-0.5">
            {Array.from(categoryCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([cat, count]) => (
                <button
                  key={cat}
                  onClick={() => {
                    setCategoryFilter(categoryFilter === cat ? null : cat);
                  }}
                  className={cn(
                    "text-left px-1.5 py-0.5 text-hd-10 cursor-pointer transition-colors-fast truncate",
                    categoryFilter === cat
                      ? "bg-desert-amber/15 text-desert-amber"
                      : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10",
                  )}
                >
                  {cat}
                  <span className="ml-1 tabular-nums text-bevel-dark/85">{count}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Series */}
      {seriesCounts.size > 0 && (
        <div>
          <div className="text-hd-10 text-desert-amber uppercase tracking-wider mb-1.5 font-bold">
            Series
          </div>
          <div className="flex flex-col gap-0.5">
            {Array.from(seriesCounts.entries())
              .filter(([, count]) => count >= 2)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([series, count]) => (
                <button
                  key={series}
                  onClick={() => {
                    setSeriesFilter(seriesFilter === series ? null : series);
                  }}
                  className={cn(
                    "text-left px-1.5 py-0.5 text-hd-10 cursor-pointer transition-colors-fast truncate",
                    seriesFilter === series
                      ? "bg-title-bar-blue/20 text-signal-blue"
                      : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10",
                  )}
                >
                  {series}
                  <span className="ml-1 tabular-nums text-bevel-dark/85">{count} parts</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Top Topics */}
      {topTopics.length > 0 && (
        <div>
          <div className="text-hd-10 text-desert-amber uppercase tracking-wider mb-1.5 font-bold">
            Topics
          </div>
          <div className="flex flex-col gap-0.5">
            {topTopics.map(([topic, count]) => (
              <button
                key={topic}
                onClick={() => {
                  onTopic(topic);
                }}
                className="text-left px-1.5 py-0.5 text-hd-10 text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10 cursor-pointer transition-colors-fast truncate"
              >
                {topic}
                <span className="ml-1 tabular-nums text-bevel-dark/85">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
