"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { SearchBar } from "@/components/library/SearchBar";
import { TimelineView } from "@/components/library/TimelineView";
import { EpisodeDetail } from "@/components/library/EpisodeDetail";
import { Window } from "@/components/win98";

type SortMode = "date" | "name";

export default function LibraryPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("date");
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const currentEpisodeId = usePlayerStore((s) => s.currentEpisode?.id);

  // Listen for sort events from the menu bar
  useEffect(() => {
    const handler = (e: Event) => {
      const sort = (e as CustomEvent<string>).detail;
      if (sort === "date" || sort === "name") setSortMode(sort);
    };
    window.addEventListener("hd:sort", handler);
    return () => window.removeEventListener("hd:sort", handler);
  }, []);

  const allEpisodes = useLiveQuery(
    () => db.episodes.orderBy("airDate").reverse().toArray(),
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

  const handleEpisodeClick = useCallback((episode: Episode) => {
    setSelectedEpisode(episode);
  }, []);

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

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 flex-shrink-0">
        <Window title="Library" variant="dark">
          <div className="p-2">
            <SearchBar
              value={search}
              onChange={setSearch}
              resultCount={allEpisodes ? filtered.length : undefined}
            />
          </div>
        </Window>
      </div>
      <div className="flex-1 overflow-hidden flex">
        {/* Episode list */}
        <div className="flex-1 overflow-auto min-w-0">
          <TimelineView
            episodes={filtered}
            currentEpisodeId={currentEpisodeId}
            onEpisodeClick={handleEpisodeClick}
            onEpisodeDoubleClick={handleDoubleClick}
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
    </div>
  );
}
