"use client";

import type { ShowFilter } from "@/lib/library/filter-episodes";
import { SHOW_TABS } from "@/components/library/LibraryToolbar";

/**
 * Loading skeleton — also covers the window between Dexie reporting an empty
 * table and the deferred seed landing.
 */
export function LibraryListSkeleton() {
  return (
    <div className="flex-1 p-2 flex flex-col gap-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="w98-raised-dark bg-card-surface animate-skeleton p-2.5 md:p-1.5 h-[92px] md:h-[76px]"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          {/* Row 1: date + title */}
          <div className="flex items-center gap-2">
            <div className="h-[10px] bg-bevel-dark/15 rounded-sm w-[72px]" />
            <div className="h-[12px] bg-bevel-dark/10 rounded-sm flex-1 max-w-[45%]" />
          </div>
          {/* Row 2: guest / show type */}
          <div className="flex items-center gap-2 mt-2">
            <div className="h-[10px] bg-bevel-dark/8 rounded-sm w-[130px]" />
            <div className="h-[10px] bg-bevel-dark/8 rounded-sm w-[60px]" />
          </div>
          {/* Row 3: duration + tags */}
          <div className="flex items-center justify-between gap-2 mt-2">
            <div className="flex items-center gap-1.5">
              <div className="h-[8px] bg-bevel-dark/6 rounded-sm w-[44px]" />
              <div className="h-[8px] bg-bevel-dark/6 rounded-sm w-[36px]" />
            </div>
            <div className="h-[8px] bg-bevel-dark/6 rounded-sm w-[52px]" />
          </div>
        </div>
      ))}
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
