"use client";

import type { Episode } from "@/db/schema";
import type { ShowFilter } from "@/lib/library/filter-episodes";
import type { LibraryFacets } from "@/lib/library/facets";
import { usePlayerStore } from "@/stores/player-store";
import { toast } from "@/stores/toast-store";
import { SearchBar } from "@/components/library/SearchBar";
import { shuffle } from "@/lib/utils/shuffle";
import { cn } from "@/lib/utils/cn";

export const SHOW_TABS: { key: ShowFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "coast", label: "Coast to Coast" },
  { key: "dreamland", label: "Dreamland" },
  { key: "special", label: "Specials" },
  { key: "unknown", label: "Uncategorized" },
];

/**
 * Search box, shuffle-the-results, the browse-panel toggle and the show-type
 * tabs. Sticky on mobile so users can refine while scrolling.
 */
export function LibraryToolbar({
  searchBarRef,
  search,
  setSearch,
  allEpisodes,
  visibleEpisodes,
  facets,
  showFacets,
  toggleFacets,
  showFilter,
  onShowTab,
}: {
  searchBarRef: React.RefObject<HTMLInputElement | null>;
  search: string;
  setSearch: (q: string) => void;
  allEpisodes: Episode[] | undefined;
  visibleEpisodes: Episode[];
  facets: LibraryFacets;
  showFacets: boolean;
  toggleFacets: () => void;
  showFilter: ShowFilter;
  onShowTab: (key: ShowFilter) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 flex-shrink-0 md:flex-row md:items-center md:gap-2 sticky top-0 z-20 bg-midnight/95 backdrop-blur-sm md:static md:bg-transparent md:backdrop-blur-none">
      <div className="flex items-center gap-1.5 flex-1">
        <SearchBar
          ref={searchBarRef}
          value={search}
          onChange={setSearch}
          resultCount={allEpisodes ? visibleEpisodes.length : undefined}
          guests={facets.searchGuests}
          categories={facets.searchCategories}
          years={facets.searchYears}
          series={facets.searchSeries}
          className="flex-1"
        />
        {visibleEpisodes.length > 0 && (
          <button
            onClick={() => {
              const pool = shuffle(visibleEpisodes);
              const batch = pool.slice(0, 20);
              const store = usePlayerStore.getState();
              store.enqueueMany(batch);
              if (batch[0]) {
                window.dispatchEvent(new CustomEvent("hd:play-episode", { detail: batch[0] }));
              }
              toast.info(`Shuffling ${batch.length} from ${visibleEpisodes.length} episodes`);
            }}
            className="hidden md:flex items-center justify-center w-[28px] h-[28px] text-hd-11 text-bevel-dark/85 hover:text-desert-amber cursor-pointer transition-colors-fast flex-shrink-0"
            title="Shuffle filtered episodes"
            aria-label="Shuffle filtered episodes"
          >
            ⇄
          </button>
        )}
        {/* Browse-by-facet toggle. The sidebar itself already existed but was
            unreachable: showFacets was initialised false and all three
            setShowFacets calls passed false, so there was no way to open it. */}
        <button
          onClick={toggleFacets}
          className={cn(
            "hidden md:flex items-center justify-center w-[28px] h-[28px] text-hd-11 cursor-pointer transition-colors-fast flex-shrink-0",
            showFacets
              ? "text-desert-amber bg-desert-amber/15 w98-inset-dark"
              : "text-bevel-dark/85 hover:text-desert-amber",
          )}
          title={showFacets ? "Hide browse panel" : "Browse by guest, category or series"}
          aria-label="Toggle browse panel"
          aria-pressed={showFacets}
        >
          ☰
        </button>
      </div>
      {allEpisodes && allEpisodes.length > 0 && (
        <div className="flex items-center gap-1 md:gap-0.5 flex-shrink-0 overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0">
          {SHOW_TABS.map((tab) => {
            const count = facets.showCounts.get(tab.key) ?? 0;
            const isActive = showFilter === tab.key;
            if (count === 0 && tab.key !== "all") return null;
            return (
              <button
                key={tab.key}
                onClick={() => onShowTab(tab.key)}
                className={cn(
                  "px-3 py-1.5 text-hd-13 md:px-2 md:py-0.5 md:text-hd-10 cursor-pointer transition-colors-fast whitespace-nowrap flex-shrink-0",
                  isActive
                    ? "bg-title-bar-blue/20 text-desktop-gray w98-inset-dark"
                    : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10 active:bg-title-bar-blue/20",
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
