"use client";

import { useCallback, useRef } from "react";
import { useScraperStore } from "@/stores/scraper-store";
import { scrapeArchiveCatalog } from "@/lib/archive/scraper";
import { getArchiveItem, getStreamUrl, pickBestAudioFile } from "@/lib/archive/client";
import { fetchWithRetry } from "@/lib/utils/retry";
import { db } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";
import type { ArchiveSearchResult } from "@/lib/archive/types";

export function useCatalogScraper() {
  const store = useScraperStore();
  const abortRef = useRef<AbortController | null>(null);

  const startScrape = useCallback(async () => {
    if (store.phase !== "idle" && store.phase !== "done" && store.phase !== "error" && store.phase !== "cancelled") {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    store.start();

    try {
      // Phase 1: Scrape — collect all identifiers
      const allItems: ArchiveSearchResult[] = [];

      for await (const batch of scrapeArchiveCatalog(controller.signal, store.updateProgress)) {
        allItems.push(...batch);
      }

      if (controller.signal.aborted) {
        store.setPhase("cancelled");
        return;
      }

      // Phase 2: Import — fetch metadata per item, save to Dexie
      store.setPhase("importing");
      let imported = 0;
      let duplicates = 0;

      for (const item of allItems) {
        if (controller.signal.aborted) {
          store.setPhase("cancelled");
          return;
        }

        try {
          // Check for existing
          const existing = await db.episodes
            .where("archiveIdentifier")
            .equals(item.identifier)
            .first();

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

          const episode: Omit<Episode, "id"> = {
            fileHash: `archive:${item.identifier}`,
            filePath: streamUrl,
            fileName: bestFile.name,
            fileSize: Number(bestFile.size ?? 0),
            title: archiveItem.metadata.title ?? item.title,
            artist: typeof archiveItem.metadata.creator === "string" ? archiveItem.metadata.creator : "Art Bell",
            airDate,
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

      // Phase 3: Categorize — batch AI categorization
      store.setPhase("categorizing");
      const uncategorized = await db.episodes
        .where("aiStatus")
        .equals("pending")
        .toArray();

      const chunkSize = 10;
      let categorized = 0;

      for (let i = 0; i < uncategorized.length; i += chunkSize) {
        if (controller.signal.aborted) {
          store.setPhase("cancelled");
          return;
        }

        const chunk = uncategorized.slice(i, i + chunkSize);
        try {
          const res = await fetchWithRetry("/api/categorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              episodes: chunk.map((ep) => ({
                title: ep.title,
                fileName: ep.fileName,
                airDate: ep.airDate,
                guestName: ep.guestName,
              })),
            }),
            signal: controller.signal,
          }, { retries: 1 });

          if (res.ok) {
            const results = await res.json();
            if (Array.isArray(results)) {
              for (let j = 0; j < results.length && j < chunk.length; j++) {
                const { summary, tags, topic, guestName } = results[j];
                await db.episodes.update(chunk[j].id!, {
                  aiSummary: summary ?? undefined,
                  aiTags: tags ?? undefined,
                  topic: topic ?? chunk[j].topic,
                  guestName: guestName ?? chunk[j].guestName,
                  aiStatus: "completed",
                  updatedAt: Date.now(),
                });
                categorized++;
              }
              store.updateProgress({ categorized });
            }
          } else {
            // Mark chunk as failed
            for (const ep of chunk) {
              await db.episodes.update(ep.id!, { aiStatus: "failed", updatedAt: Date.now() });
            }
            store.addError(`Categorization failed for batch at index ${i}`);
          }
        } catch (err) {
          if (controller.signal.aborted) {
            store.setPhase("cancelled");
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          store.addError(`Categorize batch error: ${msg}`);
          for (const ep of chunk) {
            await db.episodes.update(ep.id!, { aiStatus: "failed", updatedAt: Date.now() });
          }
        }

        // 1s delay between batches
        if (i + chunkSize < uncategorized.length) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      store.setPhase("done");
    } catch (err) {
      if (controller.signal.aborted) {
        store.setPhase("cancelled");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        store.addError(msg);
        store.setPhase("error");
      }
    }
  }, [store]);

  const cancelScrape = useCallback(() => {
    abortRef.current?.abort();
    store.setPhase("cancelled");
  }, [store]);

  return {
    ...store,
    startScrape,
    cancelScrape,
  };
}
