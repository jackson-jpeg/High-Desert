"use client";

import { useCallback, useRef, useState } from "react";
import { fetchWithRetry } from "@/lib/utils/retry";
import { runCollectionImport, type CollectionInfo } from "@/services/archive/collection-import";
import { toast } from "@/stores/toast-store";
import type { ArchiveFile } from "@/services/archive/types";

export type { CollectionInfo };

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

/**
 * Thin React shell over `runCollectionImport`
 * (src/services/archive/collection-import.ts), which owns the loop and is tested
 * against a real database. This file holds only the metadata fetch and the
 * progress state.
 */
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
  const startImport = useCallback(async () => {
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

    try {
      const result = await runCollectionImport(controller.signal, info, {
        updateProgress: update,
        setPhase: (phase) => update({ phase }),
        setCurrentFile: (currentFile) => update({ currentFile }),
        addError,
      });

      if (result.outcome === "cancelled") {
        toast.info(`Import cancelled — ${result.imported} episodes imported`);
        return;
      }
      toast.success(
        `Imported ${result.imported} episodes (${result.duplicates} duplicates skipped)`,
      );
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
