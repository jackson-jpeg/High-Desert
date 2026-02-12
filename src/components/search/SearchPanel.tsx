"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Window, TextField, Button } from "@/components/win98";
import { ArchiveResultCard } from "./ArchiveResultCard";
import { useArchiveSearch } from "@/hooks/useArchiveSearch";

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

            {totalResults > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-bevel-dark">
                  {totalResults.toLocaleString()} results found (page {page})
                </span>
                {newCount > 0 && (
                  <Button
                    size="sm"
                    variant="dark"
                    onClick={() => addAllToLibrary(results)}
                    disabled={loading}
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

      {/* Results list */}
      <div className="flex-1 overflow-auto px-3 pb-3">
        <div className="flex flex-col gap-2">
          {results.map((result) => (
            <ArchiveResultCard
              key={result.identifier}
              result={result}
              isAdding={addingIds.has(result.identifier)}
              isAdded={addedIds.has(result.identifier)}
              onAdd={addToLibrary}
            />
          ))}
        </div>

        {/* Pagination */}
        {totalResults > 0 && (
          <div className="flex items-center justify-center gap-4 py-3">
            <Button
              size="sm"
              variant="dark"
              onClick={handlePrevPage}
              disabled={page <= 1 || loading}
            >
              ← Prev
            </Button>
            <span className="text-[10px] text-bevel-dark">
              Page {page}
            </span>
            <Button
              size="sm"
              variant="dark"
              onClick={handleNextPage}
              disabled={!hasMore || loading}
            >
              Next →
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
