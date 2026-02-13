"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { useContextMenuStore } from "@/stores/context-menu-store";
import { deleteEpisode, recategorizeEpisode } from "@/lib/episodes/management";
import { SearchBar } from "@/components/library/SearchBar";
import { TimelineView } from "@/components/library/TimelineView";
import { EpisodeDetail } from "@/components/library/EpisodeDetail";
import { RecentlyPlayed } from "@/components/library/RecentlyPlayed";
import { Window, Dialog, Button } from "@/components/win98";

type SortMode = "date" | "name" | "guest";
type ShowFilter = "all" | "coast" | "dreamland" | "special" | "unknown";

const SHOW_TABS: { key: ShowFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "coast", label: "Coast to Coast" },
  { key: "dreamland", label: "Dreamland" },
  { key: "special", label: "Specials" },
  { key: "unknown", label: "Uncategorized" },
];

export default function LibraryPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [showFilter, setShowFilter] = useState<ShowFilter>("all");
  const [guestFilter, setGuestFilter] = useState<string | null>(null);
  const [showFacets, setShowFacets] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const currentEpisodeId = usePlayerStore((s) => s.currentEpisode?.id);
  const searchBarRef = useRef<HTMLInputElement>(null);

  // Listen for sort events from the menu bar
  useEffect(() => {
    const handler = (e: Event) => {
      const sort = (e as CustomEvent<string>).detail;
      if (sort === "date" || sort === "name" || sort === "guest") setSortMode(sort as SortMode);
    };
    window.addEventListener("hd:sort", handler);
    return () => window.removeEventListener("hd:sort", handler);
  }, []);

  // Listen for focus-search events
  useEffect(() => {
    const handler = () => {
      searchBarRef.current?.focus();
    };
    window.addEventListener("hd:focus-search", handler);
    return () => window.removeEventListener("hd:focus-search", handler);
  }, []);

  const allEpisodes = useLiveQuery(
    () => db.episodes.orderBy("airDate").reverse().toArray(),
    [],
  );

  const recentlyPlayed = useLiveQuery(
    () => db.episodes.where("lastPlayedAt").above(0).sortBy("lastPlayedAt").then((eps) => eps.reverse().slice(0, 5)),
    [],
  );

  // Show type counts for filter tabs
  const showCounts = useMemo(() => {
    if (!allEpisodes) return new Map<ShowFilter, number>();
    const counts = new Map<ShowFilter, number>();
    counts.set("all", allEpisodes.length);
    for (const ep of allEpisodes) {
      const type = (ep.showType ?? "unknown") as ShowFilter;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return counts;
  }, [allEpisodes]);

  // Top guests for faceted browsing
  const topGuests = useMemo(() => {
    if (!allEpisodes) return [];
    const guestCounts = new Map<string, number>();
    for (const ep of allEpisodes) {
      if (ep.guestName) {
        guestCounts.set(ep.guestName, (guestCounts.get(ep.guestName) ?? 0) + 1);
      }
    }
    return Array.from(guestCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
  }, [allEpisodes]);

  // Top topics for faceted browsing
  const topTopics = useMemo(() => {
    if (!allEpisodes) return [];
    const topicCounts = new Map<string, number>();
    for (const ep of allEpisodes) {
      if (ep.topic) {
        topicCounts.set(ep.topic, (topicCounts.get(ep.topic) ?? 0) + 1);
      }
    }
    return Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
  }, [allEpisodes]);

  const filtered = useMemo(() => {
    if (!allEpisodes) return [];

    let list = allEpisodes;

    // Show type filter
    if (showFilter !== "all") {
      list = list.filter((ep) => (ep.showType ?? "unknown") === showFilter);
    }

    // Guest filter
    if (guestFilter) {
      list = list.filter((ep) => ep.guestName === guestFilter);
    }

    // Search filter (includes aiTags)
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (ep) =>
          ep.fileName.toLowerCase().includes(q) ||
          ep.title?.toLowerCase().includes(q) ||
          ep.guestName?.toLowerCase().includes(q) ||
          ep.topic?.toLowerCase().includes(q) ||
          ep.airDate?.includes(q) ||
          ep.description?.toLowerCase().includes(q) ||
          ep.aiTags?.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    // Sort
    if (sortMode === "name") {
      list = [...list].sort((a, b) => {
        const nameA = (a.title || a.fileName).toLowerCase();
        const nameB = (b.title || b.fileName).toLowerCase();
        return nameA.localeCompare(nameB);
      });
    } else if (sortMode === "guest") {
      list = [...list].sort((a, b) => {
        const gA = (a.guestName || "").toLowerCase();
        const gB = (b.guestName || "").toLowerCase();
        return gA.localeCompare(gB) || (a.airDate ?? "").localeCompare(b.airDate ?? "");
      });
    }
    // "date" is already the default order from Dexie (airDate desc)

    return list;
  }, [allEpisodes, search, sortMode, showFilter, guestFilter]);

  const handleEpisodeClick = useCallback((episode: Episode, e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (e.shiftKey && lastClickedId != null) {
          const allIds = filtered.map((ep) => ep.id!);
          const startIdx = allIds.indexOf(lastClickedId);
          const endIdx = allIds.indexOf(episode.id!);
          if (startIdx !== -1 && endIdx !== -1) {
            const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            for (let i = lo; i <= hi; i++) {
              next.add(allIds[i]);
            }
          }
        } else {
          if (next.has(episode.id!)) {
            next.delete(episode.id!);
          } else {
            next.add(episode.id!);
          }
        }
        return next;
      });
    } else {
      setSelectedIds(new Set());
      setSelectedEpisode(episode);
    }
    setLastClickedId(episode.id!);
  }, [filtered, lastClickedId]);

  const handlePlay = useCallback((episode: Episode) => {
    window.dispatchEvent(
      new CustomEvent("hd:play-episode", { detail: episode }),
    );
  }, []);

  const handleDoubleClick = useCallback((episode: Episode) => {
    window.dispatchEvent(
      new CustomEvent("hd:play-episode", { detail: episode }),
    );
  }, []);

  const handleAction = useCallback((action: "scan" | "search") => {
    router.push(action === "scan" ? "/scanner" : "/search");
  }, [router]);

  const handleCloseDetail = useCallback(() => {
    setSelectedEpisode(null);
  }, []);

  const handleContextMenu = useCallback((episode: Episode, x: number, y: number) => {
    const isPlaying = episode.id === currentEpisodeId;
    const store = usePlayerStore.getState();

    useContextMenuStore.getState().show(x, y, [
      {
        label: "Play",
        onClick: () => handlePlay(episode),
        disabled: isPlaying,
      },
      {
        label: "Play Next",
        onClick: () => store.enqueueNext(episode),
        disabled: isPlaying,
      },
      {
        label: "Add to Queue",
        onClick: () => store.enqueue(episode),
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: "Re-categorize",
        onClick: () => recategorizeEpisode(episode.id!),
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: "Delete",
        onClick: async () => {
          if (selectedIds.size > 1 && selectedIds.has(episode.id!)) {
            setDeleteOpen(true);
          } else {
            await deleteEpisode(episode.id!);
            if (selectedEpisode?.id === episode.id) setSelectedEpisode(null);
          }
        },
        danger: true,
      },
    ]);
  }, [currentEpisodeId, handlePlay, selectedIds, selectedEpisode]);

  const handleBulkDelete = useCallback(async () => {
    setDeleting(true);
    try {
      for (const id of selectedIds) {
        await deleteEpisode(id);
      }
      setSelectedIds(new Set());
      setSelectedEpisode(null);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }, [selectedIds]);

  // Keyboard navigation for the library list
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.code === "ArrowUp" && e.shiftKey) {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.max(0, prev - 1);
          const ep = filtered[next];
          if (ep) setSelectedEpisode(ep);
          return next;
        });
      } else if (e.code === "ArrowDown" && e.shiftKey) {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.min(filtered.length - 1, prev + 1);
          const ep = filtered[next];
          if (ep) setSelectedEpisode(ep);
          return next;
        });
      } else if (e.code === "Enter" && selectedEpisode) {
        e.preventDefault();
        handlePlay(selectedEpisode);
      } else if (e.code === "Delete" || e.code === "Backspace") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          setDeleteOpen(true);
        } else if (selectedEpisode) {
          e.preventDefault();
          deleteEpisode(selectedEpisode.id!).then(() => setSelectedEpisode(null));
        }
      } else if (e.code === "Escape") {
        setSelectedIds(new Set());
        setSelectedEpisode(null);
        setFocusedIndex(-1);
        setGuestFilter(null);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, focusedIndex, selectedEpisode, selectedIds, handlePlay]);

  const hasActiveFilters = showFilter !== "all" || guestFilter !== null;

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 pb-0 flex-shrink-0">
        <Window title="Library" variant="dark">
          <div className="p-2 flex flex-col gap-2">
            <SearchBar
              ref={searchBarRef}
              value={search}
              onChange={setSearch}
              resultCount={allEpisodes ? filtered.length : undefined}
            />

            {/* Show type filter tabs */}
            {allEpisodes && allEpisodes.length > 0 && (
              <div className="flex items-center gap-0.5 overflow-x-auto">
                {SHOW_TABS.map((tab) => {
                  const count = showCounts.get(tab.key) ?? 0;
                  const isActive = showFilter === tab.key;
                  if (count === 0 && tab.key !== "all") return null;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => {
                        setShowFilter(tab.key);
                        setGuestFilter(null);
                      }}
                      className={`
                        px-2 py-0.5 text-[9px] cursor-pointer transition-colors-fast whitespace-nowrap
                        ${isActive
                          ? "bg-title-bar-blue/20 text-desktop-gray w98-inset-dark"
                          : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10"
                        }
                      `}
                    >
                      {tab.label}
                      <span className="ml-1 tabular-nums opacity-60">{count}</span>
                    </button>
                  );
                })}

                {/* Facets toggle */}
                <button
                  onClick={() => setShowFacets(!showFacets)}
                  className={`
                    ml-auto px-2 py-0.5 text-[9px] cursor-pointer transition-colors-fast
                    ${showFacets ? "text-desert-amber" : "text-bevel-dark hover:text-desktop-gray"}
                  `}
                  title="Browse by guest or topic"
                >
                  {showFacets ? "Hide Facets" : "Browse"}
                </button>
              </div>
            )}

            {/* Active filter indicator */}
            {hasActiveFilters && (
              <div className="flex items-center gap-2 text-[9px]">
                {guestFilter && (
                  <span className="bg-static-green/15 text-static-green px-1.5 py-0.5 flex items-center gap-1">
                    Guest: {guestFilter}
                    <button
                      onClick={() => setGuestFilter(null)}
                      className="text-static-green/60 hover:text-static-green cursor-pointer"
                    >
                      x
                    </button>
                  </span>
                )}
                <button
                  onClick={() => {
                    setShowFilter("all");
                    setGuestFilter(null);
                  }}
                  className="text-bevel-dark hover:text-desktop-gray cursor-pointer ml-auto"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </Window>
      </div>

      {/* Recently played */}
      {recentlyPlayed && recentlyPlayed.length > 0 && !search.trim() && !hasActiveFilters && (
        <div className="px-3 py-2 flex-shrink-0">
          <RecentlyPlayed episodes={recentlyPlayed} onPlay={handlePlay} />
        </div>
      )}

      <div className="flex-1 overflow-hidden flex">
        {/* Faceted browsing sidebar */}
        {showFacets && allEpisodes && allEpisodes.length > 0 && (
          <div className="w-[180px] flex-shrink-0 overflow-auto border-r border-bevel-dark/20 p-2 flex flex-col gap-3">
            {/* Top Guests */}
            {topGuests.length > 0 && (
              <div>
                <div className="text-[9px] text-desert-amber uppercase tracking-wider mb-1.5 font-bold">
                  Guests
                </div>
                <div className="flex flex-col gap-0.5">
                  {topGuests.map(([guest, count]) => (
                    <button
                      key={guest}
                      onClick={() => setGuestFilter(guestFilter === guest ? null : guest)}
                      className={`
                        text-left px-1.5 py-0.5 text-[9px] cursor-pointer transition-colors-fast truncate
                        ${guestFilter === guest
                          ? "bg-title-bar-blue/20 text-desktop-gray"
                          : "text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10"
                        }
                      `}
                    >
                      {guest}
                      <span className="ml-1 tabular-nums opacity-50">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Top Topics */}
            {topTopics.length > 0 && (
              <div>
                <div className="text-[9px] text-desert-amber uppercase tracking-wider mb-1.5 font-bold">
                  Topics
                </div>
                <div className="flex flex-col gap-0.5">
                  {topTopics.map(([topic, count]) => (
                    <button
                      key={topic}
                      onClick={() => {
                        setSearch(topic);
                        setShowFacets(false);
                      }}
                      className="text-left px-1.5 py-0.5 text-[9px] text-bevel-dark hover:text-desktop-gray hover:bg-title-bar-blue/10 cursor-pointer transition-colors-fast truncate"
                    >
                      {topic}
                      <span className="ml-1 tabular-nums opacity-50">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading skeleton */}
        {allEpisodes === undefined && (
          <div className="flex-1 p-4 flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[82px] rounded w98-inset-dark bg-inset-well animate-pulse opacity-30" />
            ))}
          </div>
        )}

        {/* Episode list */}
        {allEpisodes !== undefined && (
        <div className="flex-1 overflow-auto min-w-0">
          <TimelineView
            episodes={filtered}
            currentEpisodeId={currentEpisodeId}
            onEpisodeClick={handleEpisodeClick}
            onEpisodeDoubleClick={handleDoubleClick}
            onEpisodeContextMenu={handleContextMenu}
            onAction={handleAction}
            selectedEpisodeId={selectedEpisode?.id}
            selectedIds={selectedIds}
          />
        </div>
        )}

        {/* Detail panel */}
        {selectedEpisode && (
          <div className="w-[280px] flex-shrink-0 overflow-auto border-l border-bevel-dark/20">
            <EpisodeDetail
              episode={selectedEpisode}
              isPlaying={selectedEpisode.id === currentEpisodeId}
              onPlay={handlePlay}
              onClose={handleCloseDetail}
              onDelete={async (ep) => {
                await deleteEpisode(ep.id!);
                setSelectedEpisode(null);
              }}
              onRecategorize={(ep) => recategorizeEpisode(ep.id!)}
            />
          </div>
        )}
      </div>

      {/* Bulk delete confirmation */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Episodes"
        width="320px"
      >
        <div className="p-4 flex flex-col gap-4">
          <div className="text-[11px] text-desktop-gray">
            Delete {selectedIds.size > 0 ? selectedIds.size : 1} episode{selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="dark" onClick={handleBulkDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
