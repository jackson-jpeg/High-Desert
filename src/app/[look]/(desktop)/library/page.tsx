"use client";

import { Suspense, useState, useMemo, useCallback, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRouter } from "next/navigation";
import { db } from "@/db";
import { useLibraryEpisodes } from "@/hooks/library/useLibraryEpisodes";
import { LoadTimeout } from "@/components/LoadTimeout";
import { usePlayerStore } from "@/stores/player-store";
import { useAdminStore } from "@/stores/admin-store";
import { TimelineView } from "@/components/library/TimelineView";
import { Dialog, Button } from "@/components/win98";
import { GuestSheet } from "@/components/library/GuestSheet";
import { FacetSidebar } from "@/components/library/FacetSidebar";
import { DetailSheet } from "@/components/library/DetailSheet";
import { ExploreBand } from "@/components/library/ExploreBand";
import { ContinueListening } from "@/components/library/ContinueListening";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { InstallPrompt } from "@/components/install/InstallPrompt";
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
import { LibraryDial } from "@/components/library/LibraryDial";
import { LibraryViewSwitch } from "@/components/library/LibraryViewSwitch";
import { useLibraryView } from "@/hooks/library/useLibraryView";

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
  const currentFileHash = usePlayerStore((s) => s.currentEpisode?.fileHash ?? null);
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const isMobile = useIsMobile();
  const searchBarRef = useRef<HTMLInputElement>(null);
  // List or Dial: the radio dial is a Library mode (src/lib/look/nav.ts).
  const libraryView = useLibraryView();
  const dialMode = libraryView.view === "dial";

  const { value: allEpisodes, timedOut: episodesTimedOut, retry: retryEpisodes } = useLibraryEpisodes();

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
    disabled: dialMode,
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
    setView: libraryView.setView,
    onPlay: handlePlay,
  });

  useLibrarySearchShortcuts({
    focusSearch: () => searchBarRef.current?.focus(),
    queueSelected: () => {
      if (selectedEpisode) handleQueue(selectedEpisode);
    },
  });

  const panels = useLibraryPanels({ isMobile, allEpisodes });


  // No easter egg listens to scrolling here (2026-10-12). Mel's Hole used to
  // open on the twelfth scroll event "at the bottom" of the first scrollable
  // container, which on a phone was the page itself: iOS's momentum and bounce
  // fire dozens of those in one ordinary scroll, so it kept opening over the
  // Library. Eggs open from deliberate acts only (e2e/scroll-gestures.spec.ts).

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
    <div className="flex flex-col h-full overflow-y-auto overflow-x-hidden overscroll-contain">
      <Suspense fallback={null}>
        <LibraryIntentReader onIntent={applyIntent} />
      </Suspense>
      {/* Continue listening, front and centre: where a returning listener
          lands (a returning visit to / comes here), above the search and filters.
          Hidden when there is nothing to continue, and in the dial. On a
          phone the first rows must still fit the first screen
          (e2e/library-phone.spec.ts). */}
      {!dialMode && (
        <WidgetErrorBoundary name="Continue Listening">
          <ContinueListening onResume={handlePlay} exclude={currentFileHash} dense={isMobile} className="mx-3 mt-2 flex-shrink-0" />
        </WidgetErrorBoundary>
      )}
      {!dialMode && <InstallPrompt className="mx-3 mt-1 flex-shrink-0" />}

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
        trailing={
          libraryView.available ? (
            <div className="hd-library-modebar flex items-center flex-shrink-0 ml-auto" data-testid="library-modebar">
              <LibraryViewSwitch view={libraryView.view} onChange={libraryView.setView} />
            </div>
          ) : null
        }
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

      {!dialMode && <SortPresets filters={filters} />}

      {/* Discovery section — collapsed by default, compact when expanded */}
      {!isMobile && !deferredSearch.trim() && !hasActiveFilters && !dialMode && (
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

        {/* Gray rows while the read is out, but never forever (2026-10-13):
            past DB_WAIT_MS the page says so and offers Retry. */}
        {episodesTimedOut ? (
          <div className="flex-1 overflow-hidden min-w-0">
            <LoadTimeout what="Your library" onRetry={retryEpisodes} />
          </div>
        ) : (
          (allEpisodes === undefined || (allEpisodes.length === 0 && !seedSettled)) && <LibraryListSkeleton />
        )}

        {/* The Library's Dial mode (preview looks): the radio dial over the
            shows the filters leave, in place of the list. */}
        {dialMode && allEpisodes !== undefined && (allEpisodes.length > 0 || seedSettled) && (
          <div className="flex-1 overflow-hidden min-w-0">
            <LibraryDial
              episodes={visibleEpisodes}
              selectedEpisode={selectedEpisode}
              autoOpen={!isMobile}
              onOpen={setSelectedEpisode}
              onEscape={() => (selectedEpisode ? selection.handleCloseDetail() : libraryView.setView("list"))}
              onClearFilters={hasActiveFilters || search.trim() ? () => { filters.clearAllFilters(); setSearch(""); } : undefined}
            />
          </div>
        )}

        {/* Episode list */}
        {!dialMode && allEpisodes !== undefined && (allEpisodes.length > 0 || seedSettled) && (
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

      {/* Swipe gesture tip: shown once on a phone, under the list, so the
          first screen keeps its shows (e2e/library-phone.spec.ts). */}
      {panels.swipeTip && !dialMode && (
        <div data-testid="swipe-tip" className="mx-3 my-1 pl-3 bg-desert-amber/10 border border-desert-amber/20 rounded flex items-center justify-between gap-2 flex-shrink-0 md:hidden animate-fade-in">
          {/* Full strength: at /85 on its own tint both lines missed AA in
              Win98 (4.34 and 3.98:1, e2e/a11y.spec.ts). */}
          <span className="text-hd-12 text-desert-amber">
            Swipe a show: {"←"} favorite {"·"} queue {"→"}
          </span>
          <button
            onClick={panels.dismissSwipeTip}
            className="text-hd-12 text-bevel-dark active:text-desktop-gray cursor-pointer min-w-[28px] min-h-[28px] flex items-center justify-center"
          >
            OK
          </button>
        </div>
      )}

      {/* On a phone, Explore (recently played, On this date) sits under the
          list, collapsed: the first screen is for the shows themselves. */}
      {isMobile && !deferredSearch.trim() && !hasActiveFilters && !dialMode && (
        <ExploreBand
          expanded={panels.discoveryOpen}
          onToggle={panels.toggleDiscovery}
          recentlyPlayed={recentlyPlayed}
          onPlay={handlePlay}
          below
        />
      )}

      {/* Floating "Now Playing" button — mobile only */}
      {isMobile && currentEpisodeId && !selectedEpisode && !dialMode && (
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
