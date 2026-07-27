"use client";

import { useCallback, useRef } from "react";
import { useScraperStore } from "@/stores/scraper-store";
import { scrapeArchiveCatalog } from "@/services/archive/scraper";
import { getArchiveItem, getStreamUrl, pickBestAudioFile } from "@/services/archive/client";
import { toast } from "@/stores/toast-store";
import { db, getPreference, setPreference } from "@/db";
import { findDuplicateEpisode } from "@/db/deduplicate";
import type { Episode } from "@/db/schema";
import type { ArchiveSearchResult } from "@/services/archive/types";

export function useCatalogScraper() {
  const store = useScraperStore();
  const abortRef = useRef<AbortController | null>(null);

  const startScrape = useCallback(async (options?: { resume?: boolean }) => {
    if (store.phase !== "idle" && store.phase !== "done" && store.phase !== "error" && store.phase !== "cancelled") {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    store.start();

    try {
      // Phase 1: Scrape — collect all identifiers page by page
      const allItems: ArchiveSearchResult[] = [];

      // Check for resume page
      let resumePage: number | undefined;
      if (options?.resume) {
        const saved = await getPreference("scraper-page");
        if (saved) resumePage = parseInt(saved, 10);
      }

      for await (const batch of scrapeArchiveCatalog(controller.signal, store.updateProgress, resumePage)) {
        allItems.push(...batch);
        // Persist current page for resumability
        const currentPage = useScraperStore.getState().page;
        if (currentPage > 0) {
          setPreference("scraper-page", String(currentPage)).catch((err) => { console.warn("[scraper] Failed to save page:", err); });
        }
      }

      if (controller.signal.aborted) {
        store.setPhase("cancelled");
        return;
      }

      // Clear saved page on successful completion
      setPreference("scraper-page", "").catch((err) => { console.warn("[scraper] Failed to clear page:", err); });

      // Phase 2: Import — fetch metadata per item, save to Dexie
      store.setPhase("importing");
      let imported = 0;
      let duplicates = 0;

      for (const item of allItems) {
        if (controller.signal.aborted) {
          store.setPhase("cancelled");
          return;
        }

        store.setCurrentItem(item.identifier);

        try {
          // Check for existing via findDuplicateEpisode (checks archiveIdentifier + fileHash)
          const existing = await findDuplicateEpisode({
            archiveIdentifier: item.identifier,
            fileHash: `archive:${item.identifier}`,
          });

          if (existing) {
            duplicates++;
            store.updateProgress({ duplicates });
            continue;
          }

          // Fetch metadata
          const archiveItem = await getArchiveItem(item.identifier);
          const bestFile = pickBestAudioFile(archiveItem.files);

          if (!bestFile) {
            store.addError(`No audio file: ${item.identifier}`);
            continue;
          }

          const streamUrl = getStreamUrl(item.identifier, bestFile.name);
          const rawDate = archiveItem.metadata.date ?? item.date;
          const airDate = rawDate ? rawDate.substring(0, 10) : undefined;

          // Strip HTML from description
          const rawDesc = archiveItem.metadata.description ?? item.description;
          const description = rawDesc ? rawDesc.replace(/<[^>]*>/g, "").substring(0, 500) : undefined;

          const episode: Omit<Episode, "id"> = {
            fileHash: `archive:${item.identifier}`,
            filePath: streamUrl,
            fileName: bestFile.name,
            fileSize: Number(bestFile.size ?? 0),
            title: archiveItem.metadata.title ?? item.title,
            artist: typeof archiveItem.metadata.creator === "string" ? archiveItem.metadata.creator : "Art Bell",
            airDate,
            description,
            duration: bestFile.length ? parseFloat(bestFile.length) : undefined,
            format: "mp3",
            source: "archive",
            sourceUrl: streamUrl,
            archiveIdentifier: item.identifier,
            aiStatus: "pending",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          await db.episodes.add(episode as Episode);
          imported++;
          store.updateProgress({ imported });

          // 200ms between fetches
          await new Promise((r) => setTimeout(r, 200));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          store.addError(`${item.identifier}: ${msg}`);
        }
      }

      if (controller.signal.aborted) {
        store.setPhase("cancelled");
        return;
      }

      // Episodes are imported uncategorised. Batch AI categorisation runs offline
      // via scripts/categorize-library.py and ships in the seed catalog, so no API
      // key or admin token is ever exposed to the browser.
      store.setPhase("done");
      toast.success(`Catalog import complete — ${imported} episodes imported`);
    } catch (err) {
      if (controller.signal.aborted) {
        store.setPhase("cancelled");
        toast.info("Catalog import cancelled");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        store.addError(msg);
        store.setPhase("error");
        toast.error("Catalog import failed");
      }
    }
  }, [store]);

  const cancelScrape = useCallback(() => {
    abortRef.current?.abort();
    store.setPhase("cancelled");
  }, [store]);

  // Re-categorize ALL episodes (force uniform metadata)
  return {
    ...store,
    startScrape,
    cancelScrape,
  };
}
