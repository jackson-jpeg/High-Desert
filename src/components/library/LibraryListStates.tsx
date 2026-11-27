"use client";

import type { ShowFilter } from "@/lib/library/filter-episodes";
import { SHOW_TABS } from "@/components/library/LibraryToolbar";
import { YearDial } from "@/components/radio/YearDial";

/**
 * While the library loads (also the window between Dexie reporting an empty
 * table and the deferred seed landing): the station tuning in, not grey bars
 * (docs/UI-PLAN.md, push 3). Lit glass with static, the phosphor line, and a
 * marker sweeping the year dial; still with reduced motion (era.css).
 */
export function LibraryListSkeleton() {
  return (
    <div className="flex-1 p-3 flex flex-col items-stretch" data-testid="library-tuning">
      <div className="hd-tuning-in w98-inset-dark flex flex-col gap-3 px-4 py-5" role="status" aria-live="polite">
        <span className="hd-tuning-in-text hd-phosphor w98-font text-hd-title">Tuning in to the archive…</span>
        <div className="hd-tuning-in-dial">
          <YearDial airDate={null} />
          <span className="hd-tuning-in-sweep" aria-hidden="true" />
        </div>
        <span className="hd-tuning-in-sub text-hd-caption">Every show from 1992 to 2015, coming in now.</span>
      </div>
    </div>
  );
}

/** Empty library state. */
export function EmptyLibrary() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      {/* Decorative glyph, hidden from assistive technology: no text to read. */}
      {/* eslint-disable-next-line hd/text-opacity-floor */}
      <div className="text-hd-24 text-desert-amber opacity-30 select-none mb-3" aria-hidden="true">📡</div>
      <div className="text-hd-13 text-desktop-gray mb-2">No episodes in the library yet.</div>
      <div className="text-hd-11 text-bevel-dark/85 leading-relaxed max-w-[260px]">
        The library seeds automatically on first visit. If this persists, try refreshing the page.
      </div>
    </div>
  );
}

/**
 * Over-constrained filters. This used to fall through to TimelineView's own
 * empty state, which reads "No episodes yet — start building your late-night
 * radio archive" — factually wrong for someone who has 1,313 episodes and
 * simply picked two filters that do not intersect, and it offered no way back.
 */
export function NoFilterMatches({
  showFilter,
  categoryFilter,
  seriesFilter,
  guestFilter,
  favoritesOnly,
  playableOnly = false,
  onClear,
}: {
  showFilter: ShowFilter;
  categoryFilter: string | null;
  seriesFilter: string | null;
  guestFilter: string | null;
  favoritesOnly: boolean;
  playableOnly?: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      {/* Decorative glyph, hidden from assistive technology: no text to read. */}
      {/* eslint-disable-next-line hd/text-opacity-floor */}
      <div className="text-hd-24 text-desert-amber opacity-30 select-none mb-3" aria-hidden="true">🔍</div>
      <div className="text-hd-13 text-desktop-gray mb-2">
        No episodes match these filters.
      </div>
      <div className="text-hd-11 text-bevel-dark/85 mb-4 max-w-[280px] leading-relaxed">
        {[
          showFilter !== "all" && SHOW_TABS.find((t) => t.key === showFilter)?.label,
          categoryFilter,
          seriesFilter,
          guestFilter,
          favoritesOnly && "Favorites",
          playableOnly && "Playable now",
        ].filter(Boolean).join(" · ")}
      </div>
      <button
        onClick={onClear}
        className="text-hd-11 text-signal-blue cursor-pointer transition-colors-fast px-3 py-1.5 w98-raised-dark bg-raised-surface"
      >
        Clear filters
      </button>
    </div>
  );
}

/**
 * "In Progress" with nothing in it. Not "No episodes yet" — the library is
 * full; the listener just has not stopped a show partway through, or has, but
 * not one that matches the search or filters also in force.
 */
export function NothingInProgress({ narrowed, onShowAll }: { narrowed: boolean; onShowAll: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      {/* Decorative glyph, hidden from assistive technology: no text to read. */}
      {/* eslint-disable-next-line hd/text-opacity-floor */}
      <div className="text-hd-24 text-desert-amber opacity-30 select-none mb-3" aria-hidden="true">◑</div>
      <div className="text-hd-13 text-desktop-gray mb-2">
        {narrowed ? "Nothing in progress matches." : "Nothing half-listened yet."}
      </div>
      <div className="text-hd-11 text-bevel-dark/85 mb-4 max-w-[280px] leading-relaxed">
        {narrowed
          ? "None of the shows you have started matches this search or filter."
          : "Stop a show partway through and it waits here, so you can pick up where you left off."}
      </div>
      <button
        onClick={onShowAll}
        className="text-hd-11 text-signal-blue cursor-pointer transition-colors-fast px-3 py-1.5 w98-raised-dark bg-raised-surface"
      >
        Show all episodes
      </button>
    </div>
  );
}

/** A search with no results. Admins are offered archive.org instead. */
export function NoSearchMatches({
  search,
  isAdmin,
  onClearSearch,
  onSearchArchive,
}: {
  search: string;
  isAdmin: boolean;
  onClearSearch: () => void;
  onSearchArchive: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      <div className="text-hd-13 text-desktop-gray mb-2">
        No episodes matching &ldquo;{search}&rdquo;
      </div>
      <div className="text-hd-11 text-bevel-dark mb-4">
        Try a different search term{isAdmin ? ", or search the archive" : ""}.
      </div>
      {!isAdmin && (
        <button
          onClick={onClearSearch}
          className="text-hd-11 text-signal-blue cursor-pointer transition-colors-fast px-3 py-1.5 w98-raised-dark bg-raised-surface"
        >
          Clear search
        </button>
      )}
      {isAdmin && (
        <button
          onClick={onSearchArchive}
          className="text-hd-11 text-signal-blue hover:text-signal-blue cursor-pointer transition-colors-fast px-3 py-1.5 w98-raised-dark bg-raised-surface"
        >
          Search Archive.org for &ldquo;{search}&rdquo;
        </button>
      )}
    </div>
  );
}

/**
 * Above the list when the search matched nothing exactly and the rows are
 * close spellings (`fuzzy-search.ts`). "Did you mean" puts the spelling the
 * results use into the search box; with nothing to correct (a word only
 * matched loosely) it just says these are close matches.
 */
export function SpellingNote({
  search,
  suggestion,
  onAccept,
}: {
  search: string;
  suggestion: string | null;
  onAccept: (corrected: string) => void;
}) {
  return (
    <div
      className="hd-spelling-note mx-3 mt-1 mb-1 flex flex-wrap items-baseline gap-x-2 text-hd-11 text-bevel-dark flex-shrink-0"
      data-testid="spelling-note"
      role="status"
    >
      <span>No exact match for &ldquo;{search.trim()}&rdquo;. Showing close spellings.</span>
      {suggestion && (
        <button
          type="button"
          onClick={() => onAccept(suggestion)}
          className="text-signal-blue underline cursor-pointer min-h-touch md:min-h-0"
          data-testid="spelling-accept"
        >
          Did you mean &ldquo;{suggestion}&rdquo;?
        </button>
      )}
    </div>
  );
}
