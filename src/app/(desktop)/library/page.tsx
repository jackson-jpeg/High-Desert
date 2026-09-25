"use client";

import { Suspense, useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRouter } from "next/navigation";
import { db } from "@/db";
import { useLibraryEpisodes } from "@/hooks/library/useLibraryEpisodes";
import { usePlayerStore } from "@/stores/player-store";
import { useAdminStore } from "@/stores/admin-store";
import { TimelineView } from "@/components/library/TimelineView";
import { Dialog, Button } from "@/components/win98";
import { GuestSheet } from "@/components/library/GuestSheet";
import { FacetSidebar } from "@/components/library/FacetSidebar";
import { DetailSheet } from "@/components/library/DetailSheet";
import { ExploreBand } from "@/components/library/ExploreBand";
import { LibraryToolbar } from "@/components/library/LibraryToolbar";
import { ActiveFilterBar, MoodFilterBar, PlayableNowBar, SortPresets } from "@/components/library/LibraryFilterBars";
import { LibraryListSkeleton, EmptyLibrary, NoFilterMatches, NoSearchMatches, NothingInProgress } from "@/components/library/LibraryListStates";
import { selectLibraryEpisodes, type ShowFilter } from "@/lib/library/filter-episodes";
import { libraryListState } from "@/lib/library/list-state";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useCommunityCatalog } from "@/hooks/useCommunityCatalog";
import { useProgressIndex } from "@/stores/progress-store";
import { recentlyPlayedEpisodes } from "@/services/episodes/progress";
import { communityOf } from "@/lib/library/sort-keys";
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
import { emit } from "@/lib/events";

/**
 * The library. A composition: the list pipeline is `selectLibraryEpisodes`
 * (src/lib/library), the state and handlers are the `useLibrary*` hooks in
 * src/hooks/library, and the chrome is in src/components/library (HD-018).
 */
export default function LibraryPage() {
  const router = useRouter();
  const filters = useLibraryFilters();
  const { search, setSearch, deferredSearch, sortMode, showFilter, guestFilter, categoryFilter, seriesFilter, favoritesOnly, playableSet, hasActiveFilters } = filters;
  // Seeding is deferred to idle in the desktop layout, so an empty table is
  // ambiguous until it reports back. Until then, keep showing the skeleton.
  const [seedSettled, setSeedSettled] = useState(false);
  const [guestProfileName, setGuestProfileName] = useState<string | null>(null);
  const currentEpisodeId = usePlayerStore((s) => s.currentEpisode?.id);
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const isMobile = useIsMobile();
  const searchBarRef = useRef<HTMLInputElement>(null);

  const allEpisodes = useLibraryEpisodes();

  // From the `progress` table (HD-016): position saves wake this small query,
  // never the full-table one above.
  const recentlyPlayed = useLiveQuery(
    () => recentlyPlayedEpisodes(5).then((rows) => rows.map((r) => r.episode)),
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
  // Community plays and ratings for the whole catalog: what "Most played" and
  // "Top rated" order by, and what the list's metric column shows.
  const community = useCommunityCatalog();
  // The listener's progress, for the two sorts that order by it — and only for
  // those: any other sort gets a constant, so a position save (every 30 s while
  // playing) does not re-run the pipeline over the whole library (HD-016).
  const progress = useProgressIndex(sortMode === "recent" || sortMode === "progress");
  const visibleEpisodes = useMemo(
    () => selectLibraryEpisodes(allEpisodes, {
      search: deferredSearch, sortMode, showFilter, guestFilter, categoryFilter, seriesFilter, favoritesOnly, bookmarkedIds,
      playableOnly: playableSet,
    }, community, progress),
    [allEpisodes, deferredSearch, sortMode, showFilter, guestFilter, categoryFilter, seriesFilter, favoritesOnly, bookmarkedIds, playableSet, community, progress],
  );

  const selection = useLibrarySelection({ allEpisodes, visibleEpisodes });
  const { selectedEpisode, setSelectedEpisode, selectedIds, setSelectedIds, setFocusedIndex } = selection;

  const actions = useLibraryActions({
    allEpisodes, allPlaylists, currentEpisodeId, selectedEpisode, setSelectedEpisode, selectedIds, setSelectedIds,
  });
  const { handlePlay, handleQueue, handleToggleFavorite, deleteOpen, setDeleteOpen, requestDelete, requestBulkDelete, deleting } = actions;

  useLibraryKeyboard({
    visibleEpisodes,
    activeIndex: selection.activeIndex,
    setFocusedIndex,
    selectedEpisode,
    setSelectedEpisode,
    selectedIds,
    setSelectedIds,
    onPlay: handlePlay,
    onRequestBulkDelete: requestBulkDelete,
    onRequestDelete: requestDelete,
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

  const listState = libraryListState({
    libraryCount: allEpisodes?.length ?? 0,
    visibleCount: visibleEpisodes.length,
    search,
    hasActiveFilters,
    sortMode,
    seriesFilter,
  });

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

      <PlayableNowBar filters={filters} />

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
          {listState === "empty-library" ? (
            <EmptyLibrary />
          ) : listState === "nothing-in-progress" ? (
            <NothingInProgress
              narrowed={!!search.trim() || hasActiveFilters}
              onShowAll={() => filters.setSortMode("date")}
            />
          ) : listState === "no-filter-matches" ? (
            <NoFilterMatches
              showFilter={showFilter}
              categoryFilter={categoryFilter}
              seriesFilter={seriesFilter}
              guestFilter={guestFilter}
              favoritesOnly={favoritesOnly}
              playableOnly={playableSet !== null}
              onClear={filters.clearAllFilters}
            />
          ) : listState === "no-search-matches" ? (
            <NoSearchMatches
              search={search}
              isAdmin={isAdmin}
              onClearSearch={() => setSearch("")}
              onSearchArchive={() => router.push(`/search`)}
            />
          ) : (
            <TimelineView
              episodes={visibleEpisodes}
              sortMode={sortMode}
              seriesFilter={seriesFilter}
              community={community}
              progress={progress}
              onSortModeChange={filters.setSortMode}
              currentEpisodeId={currentEpisodeId}
              onEpisodeClick={selection.handleEpisodeClick}
              onEpisodeDoubleClick={handlePlay}
              onEpisodeContextMenu={actions.handleContextMenu}
              onAction={isAdmin ? handleAction : undefined}
              onToggleFavorite={handleToggleFavorite}
              onQueue={handleQueue}
              selectedEpisodeId={selectedEpisode?.id}
              selectedIds={selectedIds}
              activeRow={selection.activeIndex}
            />
          )}
        </div>
        )}

        {/* Guest Profile panel */}
        {guestProfileName && !selectedEpisode && (
          <GuestSheet
            guestName={guestProfileName}
            onPlay={handlePlay}
            onClose={() => setGuestProfileName(null)}
          />
        )}

        {/* Detail panel — mobile: slide-up overlay; desktop: 280px sidebar */}
        {selectedEpisode && (
          <DetailSheet
            selectedEpisode={selectedEpisode}
            selectedEpisodeLive={selection.selectedEpisodeLive}
            currentEpisodeId={currentEpisodeId}
            isAdmin={isAdmin}
            communityPlays={communityOf(selectedEpisode, community).plays || undefined}
            onPlay={handlePlay}
            onClose={selection.handleCloseDetail}
            onToggleFavorite={handleToggleFavorite}
            setSelectedEpisode={setSelectedEpisode}
            onRequestDelete={requestDelete}
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

      {/* Delete confirmation — every delete, one episode or many (HD-011) */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Episodes"
        urgent
        width="320px"
      >
        <div className="p-4 flex flex-col gap-4">
          <div className="text-hd-12 text-desktop-gray">
            Delete {actions.pendingDeleteCount} episode{actions.pendingDeleteCount !== 1 ? "s" : ""}? This cannot be undone.
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="dark" onClick={actions.handleConfirmDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
