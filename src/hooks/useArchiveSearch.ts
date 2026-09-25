"use client";

import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSearchStore } from "@/stores/search-store";
import { searchArchive, getArchiveItem, getStreamUrl, pickBestAudioFile } from "@/services/archive/client";
import { toast } from "@/stores/toast-store";
import { db } from "@/db";
import type { Episode } from "@/db/schema";
import type { ArchiveSearchResult } from "@/services/archive/types";

export function useArchiveSearch() {
  // The state the panel shows, compared shallowly; actions via getState() at
  // call time. Subscribing to the whole store and depending on it in every
  // callback rebuilt search/addToLibrary on each keystroke's state change —
  // and addAllToLibrary read addedIds from whichever render it was built in
  // (HD-040).
  const state = useSearchStore(
    useShallow((s) => ({
      query: s.query,
      results: s.results,
      totalResults: s.totalResults,
      page: s.page,
      loading: s.loading,
      error: s.error,
      addingIds: s.addingIds,
      addedIds: s.addedIds,
    })),
  );

  const search = useCallback(async (query: string, page = 1) => {
    const store = useSearchStore.getState();
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
  }, []);

  const addToLibrary = useCallback(async (result: ArchiveSearchResult) => {
    const store = useSearchStore.getState();
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

      // Strip HTML from description
      const rawDesc = item.metadata.description ?? result.description;
      const description = rawDesc ? rawDesc.replace(/<[^>]*>/g, "").substring(0, 500) : undefined;

      const episode: Omit<Episode, "id"> = {
        fileHash: `archive:${result.identifier}`,
        filePath: streamUrl,
        fileName: bestFile.name,
        fileSize: Number(bestFile.size ?? 0),
        title: item.metadata.title ?? result.title,
        artist: typeof item.metadata.creator === "string" ? item.metadata.creator : "Art Bell",
        airDate,
        description,
        duration: bestFile.length ? parseFloat(bestFile.length) : undefined,
        format: "mp3",
        source: "archive",
        sourceUrl: streamUrl,
        archiveIdentifier: result.identifier,
        aiStatus: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const id = await db.episodes.add(episode as Episode);

      // Episodes import uncategorised; batch categorisation runs offline via
      // scripts/categorize-library.py and ships in the seed catalog.
      void id;

      store.finishAdding(result.identifier);
      toast.success(`Added "${result.title}"`);
    } catch (err) {
      console.error(`[archive] Failed to add ${result.identifier}:`, err);
      store.finishAdding(result.identifier);
      toast.error(`Failed to add "${result.title}"`);
    }
  }, []);

  const addAllToLibrary = useCallback(async (results: ArchiveSearchResult[]) => {
    const { addedIds, addingIds } = useSearchStore.getState();
    const newResults = results.filter(
      (r) => !addedIds.has(r.identifier) && !addingIds.has(r.identifier),
    );

    // Batch into chunks of 10 with 1s delay between chunks (each triggers AI categorization)
    const chunkSize = 10;
    for (let i = 0; i < newResults.length; i += chunkSize) {
      const chunk = newResults.slice(i, i + chunkSize);
      await Promise.all(chunk.map((result) => addToLibrary(result)));
      if (i + chunkSize < newResults.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }, [addToLibrary]);

  return {
    ...state,
    search,
    addToLibrary,
    addAllToLibrary,
  };
}
