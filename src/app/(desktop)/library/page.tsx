"use client";

import { Suspense, useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRouter } from "next/navigation";
import { db } from "@/db";
import { usePlayerStore } from "@/stores/player-store";
import { useAdminStore } from "@/stores/admin-store";
import { TimelineView } from "@/components/library/TimelineView";
import { Dialog, Button } from "@/components/win98";
import { GuestProfile } from "@/components/library/GuestProfile";
import { FacetSidebar } from "@/components/library/FacetSidebar";
import { DetailSheet } from "@/components/library/DetailSheet";
import { ExploreBand } from "@/components/library/ExploreBand";
import { LibraryToolbar } from "@/components/library/LibraryToolbar";
import { ActiveFilterBar, MoodFilterBar, SortPresets } from "@/components/library/LibraryFilterBars";
import { LibraryListSkeleton, EmptyLibrary, NoFilterMatches, NoSearchMatches } from "@/components/library/LibraryListStates";
import { cn } from "@/lib/utils/cn";
import { selectLibraryEpisodes, type ShowFilter } from "@/lib/library/filter-episodes";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useCommunityStats } from "@/hooks/useCommunityStats";
import { useLibraryFilters } from "@/hooks/library/useLibraryFilters";
import { useLibraryFacets } from "@/hooks/library/useLibraryFacets";
import { useLibrarySelection } from "@/hooks/library/useLibrarySelection";
import { useLibraryActions } from "@/hooks/library/useLibraryActions";
import { useLibraryKeyboard } from "@/hooks/library/useLibraryKeyboard";
import { useLibraryBusListeners } from "@/hooks/library/useLibraryBusListeners";
import { useLibraryPanels } from "@/hooks/library/useLibraryPanels";
import { useLibraryIntents } from "@/hooks/library/useLibraryIntents";
import { useLibrarySearchShortcuts } from "@/hooks/library/useLibrarySearchShortcuts";
import { LibraryIntentReader } from "@/components/library/LibraryIntentReader";
import { communityKey } from "@/lib/utils/community-key";
import { emit } from "@/lib/events";

/**
 * The library. A composition: the list pipeline is `selectLibraryEpisodes`
 * (src/lib/library), the state and handlers are the `useLibrary*` hooks in
 * src/hooks/library, and the chrome is in src/components/library (HD-018).
 */
export default function LibraryPage() {
  const router = useRouter();
  const filters = useLibraryFilters();
  const { search, setSearch, deferredSearch, sortMode, showFilter, guestFilter, categoryFilter, seriesFilter, favoritesOnly, hasActiveFilters } = filters;
  // Seeding is deferred to idle in the desktop layout, so an empty table is
  // ambiguous until it reports back. Until then, keep showing the skeleton.
  const [seedSettled, setSeedSettled] = useState(false);
  const [guestProfileName, setGuestProfileName] = useState<string | null>(null);
  const currentEpisodeId = usePlayerStore((s) => s.currentEpisode?.id);
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const isMobile = useIsMobile();
  const searchBarRef = useRef<HTMLInputElement>(null);

  const allEpisodes = useLiveQuery(
    () => db.episodes.orderBy("airDate").reverse().toArray(),
    [],
  );

  const recentlyPlayed = useLiveQuery(
    () => db.episodes.where("lastPlayedAt").above(0).sortBy("lastPlayedAt").then((eps) => eps.reverse().slice(0, 5)),
    [],
  );

  const allPlaylists = useLiveQuery(() => db.playlists.toArray(), []);

  // Bookmarked episode IDs for has:bookmark search operator
  const bookmarkedIds = useLiveQuery(
    async () => {
      try {
        const bms = await db.bookmarks.toArray();
        return new Set(bms.map((b) => b.episodeId));
      } catch {
        return new Set<number>();
      }
    },
    [],
  );

  const facets = useLibraryFacets(allEpisodes);

  /**
   * The rows on screen, in order. Everything that has to agree with the list —
   * shift-click ranges, keyboard focus, scroll-to-current, a year rail — reads
   * this array; nothing re-runs the pipeline.
   */
  const visibleEpisodes = useMemo(
    () => selectLibraryEpisodes(allEpisodes, {
      search: deferredSearch, sortMode, showFilter, guestFilter, categoryFilter, seriesFilter, favoritesOnly, bookmarkedIds,
    }),
    [allEpisodes, deferredSearch, sortMode, showFilter, guestFilter, categoryFilter, seriesFilter, favoritesOnly, bookmarkedIds],
  );

  const selection = useLibrarySelection({ allEpisodes, visibleEpisodes });
  const { selectedEpisode, setSelectedEpisode, selectedIds, setSelectedIds, setFocusedIndex } = selection;

  const actions = useLibraryActions({
    allEpisodes, allPlaylists, currentEpisodeId, selectedEpisode, setSelectedEpisode, selectedIds, setSelectedIds,
  });
  const { handlePlay, handleQueue, handleToggleFavorite, deleteOpen, setDeleteOpen, requestBulkDelete, deleting } = actions;

  useLibraryKeyboard({
    visibleEpisodes,
    focusedIndex: selection.focusedIndex,
    setFocusedIndex,
    selectedEpisode,
    setSelectedEpisode,
    selectedIds,
    setSelectedIds,
    onPlay: handlePlay,
    onRequestBulkDelete: requestBulkDelete,
  });

  useLibraryBusListeners({
    setSearch,
    setCategoryFilter: filters.setCategoryFilter,
    setSeriesFilter: filters.setSeriesFilter,
    setSeedSettled,
    setGuestProfileName,
    setSelectedEpisode,
  });

  // What the rest of the app asks of the library arrives in the URL (HD-013).
  const { applyIntent, scrollToCurrent } = useLibraryIntents({
    allEpisodes,
    visibleEpisodes,
    seedSettled,
    currentEpisodeId,
    setSortMode: filters.setSortMode,
    setSearch,
    setSelectedEpisode,
    setFocusedIndex,
    onShuffle: actions.handleShuffle,
  });

  useLibrarySearchShortcuts({
    focusSearch: () => searchBarRef.current?.focus(),
    queueSelected: () => {
      if (selectedEpisode) handleQueue(selectedEpisode);
    },
  });

  const panels = useLibraryPanels({ isMobile, allEpisodes });

  // TimelineView fetches counts for its own visible window. Here we only need the
  // one episode open in the detail panel.
  const detailKeys = useMemo(() => {
    const key = selectedEpisode ? communityKey(selectedEpisode) : null;
    return key ? [key] : [];
  }, [selectedEpisode]);
  const communityCounts = useCommunityStats(detailKeys);

  // Easter egg: Mel's Hole — scroll aggressively past the bottom
  const bottomScrollRef = useRef(0);
  useEffect(() => {
    const container = document.querySelector('[class*="overflow-auto"][class*="overscroll-contain"]');
    if (!container) return;
    const handler = () => {
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
      if (atBottom) {
        bottomScrollRef.current++;
        if (bottomScrollRef.current >= 12) {
          bottomScrollRef.current = 0;
          emit("easter-egg", "melsHole");
        }
      } else {
        bottomScrollRef.current = 0;
      }
    };
    container.addEventListener("scroll", handler, { passive: true });
    return () => container.removeEventListener("scroll", handler);
  }, [visibleEpisodes]);

  const handleAction = useCallback((action: "scan" | "search") => {
    router.push(action === "scan" ? "/scanner" : "/search");
  }, [router]);

  const { setShowFilter, setGuestFilter, setSeriesFilter } = filters;
  const onShowTab = useCallback((key: ShowFilter) => {
    setShowFilter(key);
    setGuestFilter(null);
    setSeriesFilter(null);
  }, [setShowFilter, setGuestFilter, setSeriesFilter]);

  return (
    <div className="flex flex-col h-full overflow-auto overscroll-contain">
      <Suspense fallback={null}>
        <LibraryIntentReader onIntent={applyIntent} />
      </Suspense>
      <LibraryToolbar
        searchBarRef={searchBarRef}
        search={search}
        setSearch={setSearch}
        allEpisodes={allEpisodes}
        visibleEpisodes={visibleEpisodes}
        facets={facets}
        showFacets={panels.showFacets}
        toggleFacets={panels.toggleFacets}
        showFilter={showFilter}
        onShowTab={onShowTab}
      />

      <ActiveFilterBar
        filters={filters}
        allEpisodes={allEpisodes}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        isAdmin={isAdmin}
        onRequestBulkDelete={requestBulkDelete}
      />

      <MoodFilterBar filters={filters} moodFilters={facets.moodFilters} />

      {/* Swipe gesture tip — shown once on mobile */}
      {panels.swipeTip && (
        <div className="mx-3 mb-1 px-3 py-2 bg-desert-amber/10 border border-desert-amber/20 rounded flex items-center justify-between gap-2 flex-shrink-0 md:hidden animate-fade-in">
          <span className="text-hd-12 text-desert-amber/85">
            Swipe cards: {"←"} favorite {"·"} queue {"→"}
          </span>
          <button
            onClick={panels.dismissSwipeTip}
            className="text-hd-12 text-bevel-dark/85 active:text-desktop-gray cursor-pointer min-w-[28px] min-h-[28px] flex items-center justify-center"
          >
            OK
          </button>
        </div>
      )}

      <SortPresets filters={filters} />

      {/* Discovery section — collapsed by default, compact when expanded */}
      {!deferredSearch.trim() && !hasActiveFilters && (
        <ExploreBand
          expanded={panels.discoveryOpen}
          onToggle={panels.toggleDiscovery}
          recentlyPlayed={recentlyPlayed}
          onPlay={handlePlay}
        />
      )}

      <div className="flex-1 overflow-hidden flex">
        {/* Faceted browsing sidebar — desktop only */}
        {panels.showFacets && allEpisodes && allEpisodes.length > 0 && (
          <FacetSidebar
            topGuests={facets.topGuests}
            categoryCounts={facets.categoryCounts}
            seriesCounts={facets.seriesCounts}
            topTopics={facets.topTopics}
            guestFilter={guestFilter}
            setGuestFilter={filters.setGuestFilter}
            categoryFilter={categoryFilter}
            setCategoryFilter={filters.setCategoryFilter}
            seriesFilter={seriesFilter}
            setSeriesFilter={filters.setSeriesFilter}
            onTopic={setSearch}
          />
        )}

        {(allEpisodes === undefined || (allEpisodes.length === 0 && !seedSettled)) && <LibraryListSkeleton />}

        {/* Episode list */}
        {allEpisodes !== undefined && (allEpisodes.length > 0 || seedSettled) && (
        <div className="flex-1 overflow-hidden min-w-0">
          {allEpisodes.length === 0 ? (
            <EmptyLibrary />
          ) : visibleEpisodes.length === 0 && !search.trim() && hasActiveFilters ? (
            <NoFilterMatches
              showFilter={showFilter}
              categoryFilter={categoryFilter}
              seriesFilter={seriesFilter}
              guestFilter={guestFilter}
              favoritesOnly={favoritesOnly}
              onClear={filters.clearAllFilters}
            />
          ) : visibleEpisodes.length === 0 && search.trim() ? (
            <NoSearchMatches
              search={search}
              isAdmin={isAdmin}
              onClearSearch={() => setSearch("")}
              onSearchArchive={() => router.push(`/search`)}
            />
          ) : (
            <TimelineView
              episodes={visibleEpisodes}
              currentEpisodeId={currentEpisodeId}
              onEpisodeClick={selection.handleEpisodeClick}
              onEpisodeDoubleClick={handlePlay}
              onEpisodeContextMenu={actions.handleContextMenu}
              onAction={isAdmin ? handleAction : undefined}
              onToggleFavorite={handleToggleFavorite}
              onQueue={handleQueue}
              selectedEpisodeId={selectedEpisode?.id}
              selectedIds={selectedIds}
            />
          )}
        </div>
        )}

        {/* Guest Profile panel */}
        {guestProfileName && !selectedEpisode && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-40 md:hidden animate-glass-backdrop"
              onClick={() => setGuestProfileName(null)}
            />
            <div className={cn(
              "fixed bottom-0 inset-x-0 z-50 max-h-[80dvh] overflow-auto pb-[var(--safe-bottom)] animate-glass-sheet rounded-t-xl",
              "md:relative md:bottom-auto md:inset-x-auto md:w-[280px] md:flex-shrink-0 md:h-full md:max-h-none md:overflow-auto md:pb-0 md:z-auto md:border-l md:border-bevel-dark/20 md:animate-fade-in md:rounded-none",
            )}>
              <GuestProfile
                guestName={guestProfileName}
                onPlay={handlePlay}
                onClose={() => setGuestProfileName(null)}
              />
            </div>
          </>
        )}

        {/* Detail panel — mobile: slide-up overlay; desktop: 280px sidebar */}
        {selectedEpisode && (
          <DetailSheet
            selectedEpisode={selectedEpisode}
            selectedEpisodeLive={selection.selectedEpisodeLive}
            currentEpisodeId={currentEpisodeId}
            isAdmin={isAdmin}
            communityPlays={communityCounts.get(communityKey(selectedEpisode) ?? "")}
            onPlay={handlePlay}
            onClose={selection.handleCloseDetail}
            onToggleFavorite={handleToggleFavorite}
            setSelectedEpisode={setSelectedEpisode}
          />
        )}
      </div>

      {/* Floating "Now Playing" button — mobile only */}
      {isMobile && currentEpisodeId && !selectedEpisode && (
        <button
          onClick={scrollToCurrent}
          className="fixed bottom-[120px] right-3 z-25 w-[40px] h-[40px] rounded-full bg-midnight/90 border border-desert-amber/30 flex items-center justify-center shadow-lg active:scale-95 transition-transform"
          aria-label="Scroll to now playing"
          title="Scroll to now playing"
        >
          <span className="w-[5px] h-[5px] rounded-full bg-red-500 animate-on-air" />
        </button>
      )}

      {/* Bulk delete confirmation */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Episodes"
        urgent
        width="320px"
      >
        <div className="p-4 flex flex-col gap-4">
          <div className="text-hd-12 text-desktop-gray">
            Delete {selectedIds.size > 0 ? selectedIds.size : 1} episode{selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="dark" onClick={actions.handleBulkDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
