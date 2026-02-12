"use client";

import { useState, useMemo, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { SearchBar } from "@/components/library/SearchBar";
import { TimelineView } from "@/components/library/TimelineView";
import { EpisodeDetail } from "@/components/library/EpisodeDetail";
import { Window } from "@/components/win98";

export default function LibraryPage() {
  const [search, setSearch] = useState("");
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const currentEpisodeId = usePlayerStore((s) => s.currentEpisode?.id);

  const allEpisodes = useLiveQuery(
    () => db.episodes.orderBy("airDate").reverse().toArray(),
    [],
  );

  const filtered = useMemo(() => {
    if (!allEpisodes) return [];
    if (!search.trim()) return allEpisodes;

    const q = search.toLowerCase();
    return allEpisodes.filter(
      (ep) =>
        ep.fileName.toLowerCase().includes(q) ||
        ep.title?.toLowerCase().includes(q) ||
        ep.guestName?.toLowerCase().includes(q) ||
        ep.topic?.toLowerCase().includes(q) ||
        ep.airDate?.includes(q),
    );
  }, [allEpisodes, search]);

  const handleEpisodeClick = useCallback((episode: Episode) => {
    setSelectedEpisode(episode);
  }, []);

  const handlePlay = useCallback((episode: Episode) => {
    window.dispatchEvent(
      new CustomEvent("hd:play-episode", { detail: episode }),
    );
  }, []);

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
