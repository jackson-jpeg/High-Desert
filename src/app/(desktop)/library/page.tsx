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

type SortMode = "date" | "name";

export default function LibraryPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("date");
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
      if (sort === "date" || sort === "name") setSortMode(sort);
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
    () => db.episodes.where("lastPlayedAt").above(0).reverse().sortBy("lastPlayedAt").then((eps) => eps.slice(0, 5)),
    [],
  );

  const filtered = useMemo(() => {
    if (!allEpisodes) return [];

    let list = allEpisodes;

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
    }
    // "date" is already the default order from Dexie (airDate desc)

    return list;
  }, [allEpisodes, search, sortMode]);

  const handleEpisodeClick = useCallback((episode: Episode, e: React.MouseEvent) => {
    // Multi-select support via native event
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (e.shiftKey && lastClickedId != null) {
          // Range select
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
          // Toggle single
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

      if (e.code === "ArrowUp" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(0, prev - 1));
        const ep = filtered[Math.max(0, focusedIndex - 1)];
        if (ep) setSelectedEpisode(ep);
      } else if (e.code === "ArrowDown" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(filtered.length - 1, prev + 1));
        const ep = filtered[Math.min(filtered.length - 1, focusedIndex + 1)];
        if (ep) setSelectedEpisode(ep);
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
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, focusedIndex, selectedEpisode, selectedIds, handlePlay]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 flex-shrink-0">
        <Window title="Library" variant="dark">
          <div className="p-2">
            <SearchBar
              ref={searchBarRef}
              value={search}
              onChange={setSearch}
              resultCount={allEpisodes ? filtered.length : undefined}
            />
          </div>
        </Window>
      </div>

      {/* Recently played */}
      {recentlyPlayed && recentlyPlayed.length > 0 && !search.trim() && (
        <div className="px-3 pb-2 flex-shrink-0">
          <RecentlyPlayed episodes={recentlyPlayed} onPlay={handlePlay} />
        </div>
      )}

      <div className="flex-1 overflow-hidden flex">
        {/* Episode list */}
        <div className="flex-1 overflow-auto min-w-0">
          <TimelineView
            episodes={filtered}
            currentEpisodeId={currentEpisodeId}
            onEpisodeClick={handleEpisodeClick}
            onEpisodeDoubleClick={handleDoubleClick}
            onEpisodeContextMenu={handleContextMenu}
            onAction={handleAction}
            selectedEpisodeId={selectedEpisode?.id}
          />
        </div>

        {/* Detail panel */}
        {selectedEpisode && (
          <div className="w-[280px] flex-shrink-0 overflow-auto border-l border-bevel-dark/20">
            <EpisodeDetail
              episode={selectedEpisode}
              isPlaying={selectedEpisode.id === currentEpisodeId}
              onPlay={handlePlay}
              onClose={handleCloseDetail}
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
