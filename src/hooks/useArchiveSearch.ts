"use client";

import { useCallback } from "react";
import { useSearchStore } from "@/stores/search-store";
import { searchArchive, getArchiveItem, getStreamUrl, pickBestAudioFile } from "@/lib/archive/client";
import { db } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";
import type { ArchiveSearchResult } from "@/lib/archive/types";

export function useArchiveSearch() {
  const store = useSearchStore();

  const search = useCallback(async (query: string, page = 1) => {
    store.setLoading(true);
    store.setError(null);
    try {
      const data = await searchArchive(query, page);
      store.setResults(data.docs, data.numFound, page);

      // Cross-reference with Dexie to find already-added items
      const identifiers = data.docs.map((d) => d.identifier);
      const existing = await db.episodes
        .where("archiveIdentifier")
        .anyOf(identifiers)
        .toArray();
      const existingIds = existing.map((e) => e.archiveIdentifier!);
      store.markAdded(existingIds);
    } catch (err) {
      store.setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  const addToLibrary = useCallback(async (result: ArchiveSearchResult) => {
    store.startAdding(result.identifier);
    try {
      // Check for duplicate
      const existing = await db.episodes
        .where("archiveIdentifier")
        .equals(result.identifier)
        .first();
      if (existing) {
        store.finishAdding(result.identifier);
        return;
      }

      // Fetch metadata and pick best audio file
      const item = await getArchiveItem(result.identifier);
      const bestFile = pickBestAudioFile(item.files);

      if (!bestFile) {
        console.warn(`[archive] No audio file found for ${result.identifier}`);
        store.finishAdding(result.identifier);
        return;
      }

      const streamUrl = getStreamUrl(result.identifier, bestFile.name);

      // Parse date
      const rawDate = item.metadata.date ?? result.date;
      const airDate = rawDate ? rawDate.substring(0, 10) : undefined;

      const episode: Omit<Episode, "id"> = {
        fileHash: `archive:${result.identifier}`,
        filePath: streamUrl,
        fileName: bestFile.name,
        fileSize: Number(bestFile.size ?? 0),
        title: item.metadata.title ?? result.title,
        artist: typeof item.metadata.creator === "string" ? item.metadata.creator : "Art Bell",
        airDate,
        duration: bestFile.length ? parseFloat(bestFile.length) : undefined,
        format: "mp3",
        source: "archive",
        sourceUrl: streamUrl,
        archiveIdentifier: result.identifier,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const id = await db.episodes.add(episode as Episode);

      // Trigger AI categorization in the background
      categorizeEpisode({ ...episode, id } as Episode);

      store.finishAdding(result.identifier);
    } catch (err) {
      console.error(`[archive] Failed to add ${result.identifier}:`, err);
      store.finishAdding(result.identifier);
    }
  }, [store]);

  const addAllToLibrary = useCallback(async (results: ArchiveSearchResult[]) => {
    const newResults = results.filter(
      (r) => !store.addedIds.has(r.identifier) && !store.addingIds.has(r.identifier),
    );
    for (const result of newResults) {
      await addToLibrary(result);
    }
  }, [store.addedIds, store.addingIds, addToLibrary]);

  return {
    ...store,
    search,
    addToLibrary,
    addAllToLibrary,
  };
}

async function categorizeEpisode(episode: Episode) {
  try {
    const res = await fetch("/api/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodes: [{
          title: episode.title,
          fileName: episode.fileName,
          airDate: episode.airDate,
          guestName: episode.guestName,
        }],
      }),
    });

    if (!res.ok) return;

    const results = await res.json();
    if (Array.isArray(results) && results[0] && episode.id) {
      const { summary, tags, topic, guestName } = results[0];
      await db.episodes.update(episode.id, {
        aiSummary: summary ?? undefined,
        aiTags: tags ?? undefined,
        topic: topic ?? episode.topic,
        guestName: guestName ?? episode.guestName,
        updatedAt: Date.now(),
      });
    }
  } catch (err) {
    console.error("[categorize] Failed:", err);
  }
}
