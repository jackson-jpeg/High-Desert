"use client";

import { useCallback, useState, useEffect, type FormEvent } from "react";
import { Window, TextField, Button } from "@/components/win98";
import { ArchiveResultCard } from "./ArchiveResultCard";
import { useArchiveSearch } from "@/hooks/useArchiveSearch";
import { useContextMenuStore } from "@/stores/context-menu-store";
import { usePlayerStore } from "@/stores/player-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils/cn";
import { parseSearch } from "@/lib/utils/search-parser";
import type { ArchiveSearchResult } from "@/services/archive/types";

const COLLECTIONS = [
  { label: "Most Popular", query: "Art Bell" },
  { label: "Coast to Coast AM", query: "Coast to Coast AM Art Bell" },
  { label: "Dreamland", query: "Dreamland Art Bell" },
  { label: "Area 51", query: "Area 51" },
  { label: "UFOs", query: "UFO alien" },
  { label: "Ghosts", query: "ghost haunting paranormal" },
  { label: "Shadow People", query: "shadow people" },
  { label: "Remote Viewing", query: "remote viewing" },
  { label: "Time Travel", query: "time travel" },
  { label: "Prophecy", query: "prophecy prediction" },
  { label: "Conspiracy", query: "conspiracy government" },
  { label: "Science", query: "science physics quantum" },
] as const;

const FEATURED_GUESTS = [
  "Michio Kaku",
  "George Knapp",
  "Richard Hoagland",
  "Whitley Strieber",
  "Ed Dames",
  "Linda Moulton Howe",
  "Malachi Martin",
  "Robert Bigelow",
  "John Lear",
  "Mel Waters",
];

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-[3px] px-3 pb-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="p-3 w98-raised-dark bg-card-surface animate-skeleton"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="h-[10px] w-[80px] bg-bevel-dark/20 mb-2" />
          <div className="h-[11px] w-[60%] bg-bevel-dark/20 mb-2" />
          <div className="h-[10px] w-[40%] bg-bevel-dark/20" />
        </div>
      ))}
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      <div className="text-[13px] text-desktop-gray mb-2">
        No results for &ldquo;{query}&rdquo;
      </div>
      <div className="text-[11px] text-bevel-dark leading-relaxed max-w-[280px] mb-3">
        Try a different search term, like a guest name, date, or topic.
      </div>
    </div>
  );
}

export function SearchPanel() {
  const [input, setInput] = useState("");
  const {
    query,
    results,
    totalResults,
    page,
    loading,
    error,
    addingIds,
    addedIds,
    search,
    addToLibrary,
    addAllToLibrary,
  } = useArchiveSearch();

  // Auto-search "Most Popular" on first load
  const [hasInitialized, setHasInitialized] = useState(false);
  useEffect(() => {
    if (!hasInitialized && !query) {
      setHasInitialized(true);
      search("Art Bell");
    }
  }, [hasInitialized, query, search]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;

      // Validate search parameters
      const parsed = parseSearch(trimmed);
      const hasText = parsed.text.length > 0;
      const hasOperators = Object.keys(parsed).some(
        (k) => k !== 'text' && parsed[k as keyof typeof parsed] !== undefined && (k !== 'has' || (parsed.has && parsed.has.length > 0))
      );

      if (!hasText && !hasOperators) {
        toast.error('Please enter a valid search query');
        return;
      }

      search(trimmed);
    },
    [input, search],
  );

  const handleCollectionClick = useCallback(
    (q: string) => {
      setInput(q);
      search(q);
    },
    [search],
  );

  const handleGuestClick = useCallback(
    (guest: string) => {
      setInput(guest);
      search(guest);
    },
    [search],
  );

  const handleNextPage = useCallback(() => {
    if (query) search(query, page + 1);
  }, [query, page, search]);

  const handlePrevPage = useCallback(() => {
    if (query && page > 1) search(query, page - 1);
  }, [query, page, search]);

  const handleResultContextMenu = useCallback((result: ArchiveSearchResult, x: number, y: number) => {
    const isAdded = addedIds.has(result.identifier);
    useContextMenuStore.getState().show(x, y, [
      {
        label: "Add to Library",
        onClick: () => addToLibrary(result),
        disabled: isAdded,
      },
      {
        label: "Add to Library & Play",
        onClick: async () => {
          await addToLibrary(result);
          const { db } = await import("@/db");
          const episode = await db.episodes
            .where("archiveIdentifier")
            .equals(result.identifier)
            .first();
          if (episode) {
            window.dispatchEvent(
              new CustomEvent("hd:play-episode", { detail: episode }),
            );
          }
        },
        disabled: isAdded,
      },
      {
        label: "Add to Queue",
        onClick: async () => {
          if (!isAdded) await addToLibrary(result);
          const { db } = await import("@/db");
          const episode = await db.episodes
            .where("archiveIdentifier")
            .equals(result.identifier)
            .first();
          if (episode) {
            usePlayerStore.getState().enqueue(episode);
            toast.info("Added to queue");
          }
        },
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: "View on Archive.org",
        onClick: () => {
          window.open(`https://archive.org/details/${result.identifier}`, "_blank");
        },
      },
    ]);
  }, [addedIds, addToLibrary]);

  const newCount = results.filter((r) => !addedIds.has(r.identifier)).length;
  const hasMore = page * 30 < totalResults;

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 pb-0 flex-shrink-0">
        <Window title="Search Archive.org" variant="dark">
          <div className="p-2 flex flex-col gap-2">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <TextField
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Search by guest, topic, date, or keyword..."
                className="flex-1"
              />
              <Button size="sm" disabled={loading || !input.trim()}>
                {loading ? "..." : "Search"}
              </Button>
            </form>

            {/* Collection quick-picks */}
            <div className="flex flex-wrap gap-1">
              {COLLECTIONS.map((c) => (
                <button
                  key={c.label}
                  onClick={() => handleCollectionClick(c.query)}
                  className={cn(
                    "px-3 py-2.5 text-[13px] min-h-[44px] md:px-1.5 md:py-0.5 md:text-[9px] md:min-h-0 cursor-pointer transition-colors-fast",
                    query === c.query
                      ? "bg-title-bar-blue/20 text-desktop-gray w98-inset-dark"
                      : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10 active:bg-title-bar-blue/10",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Featured guests */}
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-[10px] md:text-[8px] text-bevel-dark/40 uppercase tracking-wider mr-0.5">Guests</span>
              {FEATURED_GUESTS.map((guest) => (
                <button
                  key={guest}
                  onClick={() => handleGuestClick(guest)}
                  className={cn(
                    "px-3 py-2.5 text-[13px] min-h-[44px] md:px-1.5 md:py-0.5 md:text-[9px] md:min-h-0 cursor-pointer transition-colors-fast",
                    query === guest
                      ? "bg-static-green/15 text-static-green/90"
                      : "text-bevel-dark hover:text-static-green/80 hover:bg-static-green/5 active:bg-static-green/5",
                  )}
                >
                  {guest}
                </button>
              ))}
            </div>

            {totalResults > 0 && !loading && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-bevel-dark">
                  {totalResults.toLocaleString()} results
                  {query && <span className="text-bevel-dark/60"> for &ldquo;{query}&rdquo;</span>}
                </span>
                {newCount > 0 && (
                  <Button
                    size="sm"
                    variant="dark"
                    onClick={() => addAllToLibrary(results)}
                  >
                    Add All New ({newCount})
                  </Button>
                )}
              </div>
            )}

            {error && (
              <div className="text-[10px] text-red-400">{error}</div>
            )}
          </div>
        </Window>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {loading || (!hasInitialized && results.length === 0) ? (
          <LoadingSkeleton />
        ) : results.length === 0 && query ? (
          <NoResults query={query} />
        ) : (
          <>
            <div className="flex flex-col gap-[3px] px-3 py-3">
              {results.map((result, i) => (
                <ArchiveResultCard
                  key={result.identifier}
                  result={result}
                  isAdding={addingIds.has(result.identifier)}
                  isAdded={addedIds.has(result.identifier)}
                  onAdd={addToLibrary}
                  onContextMenu={handleResultContextMenu}
                  style={{ "--i": i } as React.CSSProperties}
                  className="animate-stagger"
                />
              ))}
            </div>

            {/* Pagination */}
            {totalResults > 30 && (
              <div className="flex items-center justify-center gap-6 py-4 pb-6">
                <button
                  onClick={handlePrevPage}
                  disabled={page <= 1 || loading}
                  className="text-[10px] text-bevel-dark hover:text-desktop-gray disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors-fast px-2 py-1"
                >
                  {"\u25C0"} Prev
                </button>
                <span className="text-[10px] text-bevel-dark tabular-nums">
                  Page {page} of {totalResults > 0 ? Math.ceil(totalResults / 30) : 1}
                </span>
                <button
                  onClick={handleNextPage}
                  disabled={!hasMore || loading}
                  className="text-[10px] text-bevel-dark hover:text-desktop-gray disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors-fast px-2 py-1"
                >
                  Next {"\u25B6"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
