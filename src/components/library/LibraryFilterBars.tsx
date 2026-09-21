"use client";

import type { Episode } from "@/db/schema";
import type { MoodFilter } from "@/lib/library/facets";
import type { LibraryFilters } from "@/hooks/library/useLibraryFilters";
import { usePlayerStore } from "@/stores/player-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils/cn";

/** Active filter chips and the multi-select bar — only rendered when needed. */
export function ActiveFilterBar({
  filters,
  allEpisodes,
  selectedIds,
  setSelectedIds,
  isAdmin,
  onRequestBulkDelete,
}: {
  filters: LibraryFilters;
  allEpisodes: Episode[] | undefined;
  selectedIds: Set<number>;
  setSelectedIds: (ids: Set<number>) => void;
  isAdmin: boolean;
  onRequestBulkDelete: () => void;
}) {
  const { hasActiveFilters, guestFilter, setGuestFilter, categoryFilter, setCategoryFilter, seriesFilter, setSeriesFilter, clearAllFilters } = filters;
  if (!(hasActiveFilters || selectedIds.size > 0)) return null;
  return (
    <div className="px-3 pb-1 flex-shrink-0 flex flex-col gap-1">
      {hasActiveFilters && (
        <div className="flex items-center gap-2 text-hd-13 md:text-hd-10">
          {guestFilter && (
            <span className="bg-static-green/15 text-static-green px-2 py-1 md:px-1.5 md:py-0.5 flex items-center gap-1">
              Guest: {guestFilter}
              <button onClick={() => setGuestFilter(null)} className="text-static-green/85 hover:text-static-green active:text-static-green cursor-pointer min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 flex items-center justify-center">x</button>
            </span>
          )}
          {categoryFilter && (
            <span className="bg-desert-amber/15 text-desert-amber px-2 py-1 md:px-1.5 md:py-0.5 flex items-center gap-1">
              {categoryFilter}
              <button onClick={() => setCategoryFilter(null)} className="text-desert-amber/85 hover:text-desert-amber active:text-desert-amber cursor-pointer min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 flex items-center justify-center">x</button>
            </span>
          )}
          {seriesFilter && (
            <span className="bg-title-bar-blue/15 text-signal-blue px-2 py-1 md:px-1.5 md:py-0.5 flex items-center gap-1">
              {seriesFilter}
              <button onClick={() => setSeriesFilter(null)} className="text-signal-blue hover:text-signal-blue active:text-signal-blue cursor-pointer min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 flex items-center justify-center">x</button>
            </span>
          )}
          <button
            onClick={clearAllFilters}
            className="text-bevel-dark hover:text-desktop-gray active:text-desktop-gray cursor-pointer ml-auto min-h-touch md:min-h-0 flex items-center"
          >
            Clear filters
          </button>
        </div>
      )}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 text-hd-13 md:text-hd-10 bg-title-bar-blue/10 px-2 py-2 md:py-1 w98-inset-dark">
          <span className="text-desktop-gray font-bold">{selectedIds.size} selected</span>
          <button
            onClick={() => {
              const store = usePlayerStore.getState();
              const episodes = allEpisodes?.filter((ep) => selectedIds.has(ep.id!)) ?? [];
              store.enqueueMany(episodes);
              toast.info(`Added ${episodes.length} episodes to queue`);
            }}
            className="text-signal-blue hover:text-signal-blue cursor-pointer transition-colors-fast"
          >
            Add to Queue
          </button>
          {isAdmin && (
            <button onClick={onRequestBulkDelete} className="text-red-400/60 hover:text-red-400 cursor-pointer transition-colors-fast">Delete</button>
          )}
          <button onClick={() => setSelectedIds(new Set())} className="text-bevel-dark hover:text-desktop-gray cursor-pointer transition-colors-fast ml-auto">Deselect</button>
        </div>
      )}
    </div>
  );
}

/**
 * Mood quick filters — derived from actual episode data.
 *
 * Gated on the *deferred* search value, like the results are. Gating on the
 * raw value collapsed the chrome a frame before the list changed, so typing
 * one character jumped the list ~150px and deleting it jumped back.
 */
export function MoodFilterBar({ filters, moodFilters }: { filters: LibraryFilters; moodFilters: MoodFilter[] }) {
  const { deferredSearch, search, setSearch, categoryFilter, setCategoryFilter, favoritesOnly, setFavoritesOnly } = filters;
  if (!((!deferredSearch.trim() || deferredSearch === "has:notable") && moodFilters.length > 0)) return null;
  return (
    <div className="relative flex-shrink-0">
      <div className="flex items-center gap-1.5 md:gap-1 px-3 pb-1 overflow-x-auto -mx-3 px-3 md:mx-0 [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)] hover:[mask-image:none] focus-within:[mask-image:none]">
      {moodFilters.map((mood) => {
        const isActive =
          (mood.kind === "category" && categoryFilter === mood.category) ||
          (mood.kind === "notable" && search === "has:notable") ||
          (mood.kind === "favorite" && favoritesOnly);
        return (
          <button
            key={mood.label}
            onClick={() => {
              if (isActive) {
                setCategoryFilter(null);
                setFavoritesOnly(false);
                setSearch("");
              } else if (mood.kind === "category") {
                setCategoryFilter(mood.category!);
                setFavoritesOnly(false);
                setSearch("");
              } else if (mood.kind === "notable") {
                setSearch("has:notable");
                setCategoryFilter(null);
                setFavoritesOnly(false);
              } else if (mood.kind === "favorite") {
                setFavoritesOnly(true);
                setCategoryFilter(null);
                setSearch("");
              }
            }}
            className={cn(
              "px-3 py-1.5 md:px-2 md:py-0.5 text-hd-12 md:text-hd-10 whitespace-nowrap flex-shrink-0 cursor-pointer transition-colors-fast",
              isActive
                ? "bg-desert-amber/15 text-desert-amber w98-inset-dark"
                : "text-bevel-dark/85 hover:text-desktop-gray hover:bg-title-bar-blue/10 active:bg-title-bar-blue/15",
            )}
          >
            {mood.label}
          </button>
        );
      })}
      </div>
    </div>
  );
}

/** Sort presets — visible only when a non-default sort is active. */
export function SortPresets({ filters }: { filters: LibraryFilters }) {
  const { sortMode, setSortMode } = filters;
  if (sortMode === "date") return null;
  return (
    <div className="flex items-center gap-1 px-3 pb-1 flex-shrink-0">
      <span className="text-hd-10 text-bevel-dark/85 mr-1">Sort:</span>
      {(["date", "date-asc", "recent", "progress", "rated", "played"] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => setSortMode(mode)}
          className={cn(
            "px-2 py-0.5 text-hd-10 cursor-pointer transition-colors-fast",
            sortMode === mode
              ? "text-desert-amber bg-desert-amber/10 w98-inset-dark"
              : "text-bevel-dark/85 hover:text-desktop-gray",
          )}
        >
          {{ date: "Newest", "date-asc": "Oldest", recent: "Recent", progress: "In Progress", rated: "Top Rated", played: "Most Played" }[mode]}
        </button>
      ))}
    </div>
  );
}
