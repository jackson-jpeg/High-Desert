"use client";

import { useCallback, useRef } from "react";
import { useScraperStore } from "@/stores/scraper-store";
import { scrapeArchiveCatalog } from "@/lib/archive/scraper";
import { getArchiveItem, getStreamUrl, pickBestAudioFile } from "@/lib/archive/client";
import { fetchWithRetry } from "@/lib/utils/retry";
import { toast } from "@/stores/toast-store";
import { db, getPreference, setPreference } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";
import type { ArchiveSearchResult } from "@/lib/archive/types";

export function useCatalogScraper() {
  const store = useScraperStore();
  const abortRef = useRef<AbortController | null>(null);

  const startScrape = useCallback(async (options?: { skipCategorize?: boolean; resume?: boolean }) => {
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
          setPreference("scraper-page", String(currentPage)).catch(() => {});
        }
      }

      if (controller.signal.aborted) {
        store.setPhase("cancelled");
        return;
      }

      // Clear saved page on successful completion
      setPreference("scraper-page", "").catch(() => {});

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

      // Phase 3: Categorize — batch AI categorization (skippable)
      if (options?.skipCategorize) {
        store.setPhase("done");
        return;
      }

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
        store.setCurrentItem(`Batch ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(uncategorized.length / chunkSize)}`);

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
                description: ep.description,
                archiveIdentifier: ep.archiveIdentifier,
                source: ep.source,
                artist: ep.artist,
                topic: ep.topic,
                showType: ep.showType,
              })),
            }),
            signal: controller.signal,
          }, { retries: 1 });

          if (res.ok) {
            const results = await res.json();
            if (Array.isArray(results)) {
              for (let j = 0; j < results.length && j < chunk.length; j++) {
                const { title, summary, tags, topic, guestName, airDate, showType } = results[j];
                await db.episodes.update(chunk[j].id!, {
                  title: title ?? chunk[j].title,
                  aiSummary: summary ?? undefined,
                  aiTags: tags ?? undefined,
                  topic: topic ?? chunk[j].topic,
                  guestName: guestName ?? chunk[j].guestName,
                  airDate: airDate ?? chunk[j].airDate,
                  showType: showType ?? chunk[j].showType,
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
  const recategorizeAll = useCallback(async () => {
    if (store.phase !== "idle" && store.phase !== "done" && store.phase !== "error" && store.phase !== "cancelled") {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    store.start();
    store.setPhase("categorizing");

    const allEpisodes = await db.episodes.toArray();

    if (allEpisodes.length === 0) {
      store.setPhase("done");
      return;
    }

    store.updateProgress({ total: allEpisodes.length, fetched: allEpisodes.length });

    const chunkSize = 10;
    let categorized = 0;

    try {
      for (let i = 0; i < allEpisodes.length; i += chunkSize) {
        if (controller.signal.aborted) {
          store.setPhase("cancelled");
          return;
        }

        const chunk = allEpisodes.slice(i, i + chunkSize);
        store.setCurrentItem(`Batch ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(allEpisodes.length / chunkSize)}`);

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
                description: ep.description,
                archiveIdentifier: ep.archiveIdentifier,
                source: ep.source,
                artist: ep.artist,
                topic: ep.topic,
                showType: ep.showType,
              })),
            }),
            signal: controller.signal,
          }, { retries: 1 });

          if (res.ok) {
            const results = await res.json();
            if (Array.isArray(results)) {
              for (let j = 0; j < results.length && j < chunk.length; j++) {
                const { title, summary, tags, topic, guestName, airDate, showType } = results[j];
                await db.episodes.update(chunk[j].id!, {
                  title: title ?? chunk[j].title,
                  aiSummary: summary ?? undefined,
                  aiTags: tags ?? undefined,
                  topic: topic ?? chunk[j].topic,
                  guestName: guestName ?? chunk[j].guestName,
                  airDate: airDate ?? chunk[j].airDate,
                  showType: showType ?? chunk[j].showType,
                  aiStatus: "completed",
                  updatedAt: Date.now(),
                });
                categorized++;
              }
              store.updateProgress({ categorized });
            }
          } else {
            for (const ep of chunk) {
              await db.episodes.update(ep.id!, { aiStatus: "failed", updatedAt: Date.now() });
            }
            store.addError(`Re-categorization failed for batch at index ${i}`);
          }
        } catch (err) {
          if (controller.signal.aborted) {
            store.setPhase("cancelled");
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          store.addError(`Re-categorize batch error: ${msg}`);
          for (const ep of chunk) {
            await db.episodes.update(ep.id!, { aiStatus: "failed", updatedAt: Date.now() });
          }
        }

        if (i + chunkSize < allEpisodes.length) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      store.setPhase("done");
      toast.success(`Re-categorized ${categorized} episodes`);
    } catch (err) {
      if (controller.signal.aborted) {
        store.setPhase("cancelled");
        toast.info("Re-categorization cancelled");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        store.addError(msg);
        store.setPhase("error");
        toast.error("Re-categorization failed");
      }
    }
  }, [store]);

  // Categorize-only: run AI categorization on all pending episodes
  const categorizeOnly = useCallback(async () => {
    if (store.phase !== "idle" && store.phase !== "done" && store.phase !== "error" && store.phase !== "cancelled") {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    store.start();
    store.setPhase("categorizing");

    const uncategorized = await db.episodes
      .where("aiStatus")
      .anyOf(["pending", "failed"])
      .toArray();

    if (uncategorized.length === 0) {
      store.setPhase("done");
      return;
    }

    store.updateProgress({ total: uncategorized.length, fetched: uncategorized.length });

    const chunkSize = 10;
    let categorized = 0;

    try {
      for (let i = 0; i < uncategorized.length; i += chunkSize) {
        if (controller.signal.aborted) {
          store.setPhase("cancelled");
          return;
        }

        const chunk = uncategorized.slice(i, i + chunkSize);
        store.setCurrentItem(`Batch ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(uncategorized.length / chunkSize)}`);

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
                description: ep.description,
                archiveIdentifier: ep.archiveIdentifier,
                source: ep.source,
                artist: ep.artist,
                topic: ep.topic,
                showType: ep.showType,
              })),
            }),
            signal: controller.signal,
          }, { retries: 1 });

          if (res.ok) {
            const results = await res.json();
            if (Array.isArray(results)) {
              for (let j = 0; j < results.length && j < chunk.length; j++) {
                const { title, summary, tags, topic, guestName, airDate, showType } = results[j];
                await db.episodes.update(chunk[j].id!, {
                  title: title ?? chunk[j].title,
                  aiSummary: summary ?? undefined,
                  aiTags: tags ?? undefined,
                  topic: topic ?? chunk[j].topic,
                  guestName: guestName ?? chunk[j].guestName,
                  airDate: airDate ?? chunk[j].airDate,
                  showType: showType ?? chunk[j].showType,
                  aiStatus: "completed",
                  updatedAt: Date.now(),
                });
                categorized++;
              }
              store.updateProgress({ categorized });
            }
          } else {
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

        if (i + chunkSize < uncategorized.length) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      store.setPhase("done");
      toast.success(`Categorized ${categorized} episodes`);
    } catch (err) {
      if (controller.signal.aborted) {
        store.setPhase("cancelled");
        toast.info("Categorization cancelled");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        store.addError(msg);
        store.setPhase("error");
        toast.error("Categorization failed");
      }
    }
  }, [store]);

  return {
    ...store,
    startScrape,
    cancelScrape,
    categorizeOnly,
    recategorizeAll,
  };
}
