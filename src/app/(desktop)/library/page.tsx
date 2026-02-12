"use client";

import { useState, useMemo, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";
import { usePlayerStore } from "@/stores/player-store";
import { SearchBar } from "@/components/library/SearchBar";
import { TimelineView } from "@/components/library/TimelineView";
import { Window } from "@/components/win98";

export default function LibraryPage() {
  const [search, setSearch] = useState("");
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
    // Dispatch a custom event that the integration layer will handle
    window.dispatchEvent(
      new CustomEvent("hd:play-episode", { detail: episode }),
    );
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
      <div className="flex-1 overflow-auto">
        <TimelineView
          episodes={filtered}
          currentEpisodeId={currentEpisodeId}
          onEpisodeClick={handleEpisodeClick}
        />
      </div>
    </div>
  );
}
