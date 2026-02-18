"use client";

import { useCallback, useRef, useState } from "react";
import { db } from "@/db";
import { findDuplicateEpisode } from "@/db/deduplicate";
import { fetchWithRetry } from "@/lib/utils/retry";
import { getStreamUrl } from "@/services/archive/client";
import { parseArtBellFilename, isArtBellFilename } from "@/services/archive/filename-parser";
import { toast } from "@/stores/toast-store";
import type { Episode } from "@/db/schema";
import type { ArchiveFile } from "@/services/archive/types";

export interface CollectionInfo {
  identifier: string;
  title: string;
  description: string;
  creator: string;
  audioFiles: ArchiveFile[];
}

export interface CollectionProgress {
  phase: "idle" | "loading" | "importing" | "categorizing" | "done" | "error" | "cancelled";
  total: number;
  imported: number;
  duplicates: number;
  categorized: number;
  errors: number;
  currentFile: string | null;
  errorMessages: string[];
}

const INITIAL_PROGRESS: CollectionProgress = {
  phase: "idle",
  total: 0,
  imported: 0,
  duplicates: 0,
  categorized: 0,
  errors: 0,
  currentFile: null,
  errorMessages: [],
};

export function useCollectionImport() {
  const [info, setInfo] = useState<CollectionInfo | null>(null);
  const [progress, setProgress] = useState<CollectionProgress>(INITIAL_PROGRESS);
  const abortRef = useRef<AbortController | null>(null);

  const update = useCallback((partial: Partial<CollectionProgress>) => {
    setProgress((p) => ({ ...p, ...partial }));
  }, []);

  const addError = useCallback((msg: string) => {
    setProgress((p) => ({
      ...p,
      errors: p.errors + 1,
      errorMessages: p.errorMessages.length < 100
        ? [...p.errorMessages, msg]
        : p.errorMessages,
    }));
  }, []);

  /**
   * Load collection metadata (preview before import).
   */
  const loadCollection = useCallback(async (identifier: string) => {
    setProgress({ ...INITIAL_PROGRESS, phase: "loading" });
    setInfo(null);

    try {
      const res = await fetchWithRetry(
        `/api/archive/metadata?id=${encodeURIComponent(identifier)}`,
        {},
        { retries: 2, delay: 2000 },
      );

      if (!res.ok) {
        update({ phase: "error" });
        addError(`Failed to load collection: ${res.status}`);
        toast.error("Failed to load collection metadata");
        return null;
      }

      const data = await res.json();
      const audioFiles: ArchiveFile[] = data.files ?? [];

      const collection: CollectionInfo = {
        identifier: data.identifier ?? identifier,
        title: data.metadata?.title ?? identifier,
        description: (data.metadata?.description ?? "").replace(/<[^>]*>/g, "").substring(0, 300),
        creator: data.metadata?.creator ?? "Unknown",
        audioFiles,
      };

      setInfo(collection);
      update({ phase: "idle", total: audioFiles.length });
      return collection;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      update({ phase: "error" });
      addError(msg);
      toast.error("Failed to load collection");
      return null;
    }
  }, [update, addError]);

  /**
   * Import all audio files from a loaded collection as individual episodes.
   */
  const startImport = useCallback(async (options?: { skipCategorize?: boolean }) => {
    if (!info) return;
    if (progress.phase !== "idle" && progress.phase !== "done" && progress.phase !== "error" && progress.phase !== "cancelled") {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setProgress({
      ...INITIAL_PROGRESS,
      phase: "importing",
      total: info.audioFiles.length,
    });

    let imported = 0;
    let duplicates = 0;

    try {
      for (const file of info.audioFiles) {
        if (controller.signal.aborted) {
          update({ phase: "cancelled" });
          return;
        }

        update({ currentFile: file.name });

        try {
          const fileHash = `archive:${info.identifier}:${file.name}`;

          // Deduplicate via findDuplicateEpisode (checks archiveIdentifier + fileHash)
          const existing = await findDuplicateEpisode({
            fileHash,
            archiveIdentifier: `${info.identifier}/${file.name}`,
          });

          if (existing) {
            duplicates++;
            update({ duplicates });
            continue;
          }

          // Parse filename for metadata
          const parsed = isArtBellFilename(file.name)
            ? parseArtBellFilename(file.name)
            : null;

          const streamUrl = getStreamUrl(info.identifier, file.name);
          const duration = file.length ? parseFloat(file.length) : undefined;

          const episode: Omit<Episode, "id"> = {
            fileHash,
            filePath: streamUrl,
            fileName: file.name,
            fileSize: Number(file.size ?? 0),
            title: parsed?.title ?? file.name.replace(/\.\w+$/, ""),
            artist: "Art Bell",
            airDate: parsed?.airDate,
            guestName: parsed?.guestName,
            topic: parsed?.topic,
            showType: parsed?.showType,
            description: undefined,
            duration,
            format: file.format?.includes("MP3") ? "mp3" : file.format?.toLowerCase() ?? "mp3",
            source: "archive",
            sourceUrl: streamUrl,
            archiveIdentifier: info.identifier,
            aiStatus: "pending",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          await db.episodes.add(episode as Episode);
          imported++;
          update({ imported });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addError(`${file.name}: ${msg}`);
        }
      }

      if (controller.signal.aborted) {
        update({ phase: "cancelled" });
        toast.info(`Import cancelled — ${imported} episodes imported`);
        return;
      }

      // Phase 2: AI Categorization (optional)
      if (options?.skipCategorize || imported === 0) {
        update({ phase: "done", currentFile: null });
        toast.success(`Imported ${imported} episodes (${duplicates} duplicates skipped)`);
        return;
      }

      update({ phase: "categorizing", currentFile: null });

      const uncategorized = await db.episodes
        .where("aiStatus")
        .equals("pending")
        .and((ep) => ep.archiveIdentifier === info.identifier)
        .toArray();

      const chunkSize = 10;
      let categorized = 0;

      for (let i = 0; i < uncategorized.length; i += chunkSize) {
        if (controller.signal.aborted) {
          update({ phase: "cancelled" });
          return;
        }

        const chunk = uncategorized.slice(i, i + chunkSize);
        update({ currentFile: `Batch ${Math.floor(i / chunkSize) + 1} of ${Math.ceil(uncategorized.length / chunkSize)}` });

        try {
          const res = await fetchWithRetry("/api/categorize", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-hd-admin": "true" },
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
          }, { retries: 2, delay: 1000 });

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
              update({ categorized });
            }
          } else {
            for (const ep of chunk) {
              await db.episodes.update(ep.id!, { aiStatus: "failed", updatedAt: Date.now() });
            }
            addError(`Categorization failed for batch at index ${i}`);
          }
        } catch (err) {
          if (controller.signal.aborted) {
            update({ phase: "cancelled" });
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          addError(`Categorize batch: ${msg}`);
          for (const ep of chunk) {
            await db.episodes.update(ep.id!, { aiStatus: "failed", updatedAt: Date.now() });
          }
        }

        // 1s delay between batches
        if (i + chunkSize < uncategorized.length) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      update({ phase: "done", currentFile: null });
      toast.success(`Import complete — ${imported} episodes, ${categorized} categorized`);
    } catch (err) {
      if (controller.signal.aborted) {
        update({ phase: "cancelled" });
        toast.info("Import cancelled");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        addError(msg);
        update({ phase: "error" });
        toast.error("Import failed");
      }
    }
  }, [info, progress.phase, update, addError]);

  const cancelImport = useCallback(() => {
    abortRef.current?.abort();
    update({ phase: "cancelled" });
  }, [update]);

  const reset = useCallback(() => {
    setProgress(INITIAL_PROGRESS);
    setInfo(null);
  }, []);

  return {
    info,
    progress,
    loadCollection,
    startImport,
    cancelImport,
    reset,
  };
}
