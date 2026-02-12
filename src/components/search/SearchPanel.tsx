"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Window, TextField, Button } from "@/components/win98";
import { ArchiveResultCard } from "./ArchiveResultCard";
import { useArchiveSearch } from "@/hooks/useArchiveSearch";

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

function EmptyPrompt() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-8">
      <div className="text-[20px] text-desert-amber/60 mb-4">
        ~
      </div>
      <div className="text-[13px] text-desktop-gray mb-2">
        Search the Internet Archive
      </div>
      <div className="text-[11px] text-bevel-dark leading-relaxed max-w-[300px]">
        Find Art Bell episodes from archive.org and add them directly to your library.
      </div>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      <div className="text-[13px] text-desktop-gray mb-2">
        No results for &ldquo;{query}&rdquo;
      </div>
      <div className="text-[11px] text-bevel-dark leading-relaxed max-w-[280px]">
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

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (input.trim()) {
        search(input.trim());
      }
    },
    [input, search],
  );

  const handleNextPage = useCallback(() => {
    if (query) search(query, page + 1);
  }, [query, page, search]);

  const handlePrevPage = useCallback(() => {
    if (query && page > 1) search(query, page - 1);
  }, [query, page, search]);

  const newCount = results.filter((r) => !addedIds.has(r.identifier)).length;
  const hasMore = page * 30 < totalResults;
  const hasSearched = query.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 flex-shrink-0">
        <Window title="Search Archive.org" variant="dark">
          <div className="p-2 flex flex-col gap-2">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <TextField
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Search Art Bell episodes..."
                className="flex-1"
              />
              <Button size="sm" disabled={loading || !input.trim()}>
                {loading ? "Searching..." : "Search"}
              </Button>
            </form>

            {totalResults > 0 && !loading && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-bevel-dark">
                  {totalResults.toLocaleString()} results
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

      {/* Content area: empty / loading / results */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <LoadingSkeleton />
        ) : !hasSearched ? (
          <EmptyPrompt />
        ) : results.length === 0 ? (
          <NoResults query={query} />
        ) : (
          <>
            <div className="flex flex-col gap-[3px] px-3 pb-3">
              {results.map((result, i) => (
                <ArchiveResultCard
                  key={result.identifier}
                  result={result}
                  isAdding={addingIds.has(result.identifier)}
                  isAdded={addedIds.has(result.identifier)}
                  onAdd={addToLibrary}
                  style={{ "--i": i } as React.CSSProperties}
                  className="animate-stagger"
                />
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-center gap-6 py-4 pb-6">
              <button
                onClick={handlePrevPage}
                disabled={page <= 1 || loading}
                className="text-[10px] text-bevel-dark hover:text-desktop-gray disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors-fast"
              >
                Prev
              </button>
              <span className="text-[10px] text-bevel-dark tabular-nums">
                {page} / {Math.ceil(totalResults / 30)}
              </span>
              <button
                onClick={handleNextPage}
                disabled={!hasMore || loading}
                className="text-[10px] text-bevel-dark hover:text-desktop-gray disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors-fast"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
