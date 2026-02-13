"use client";

/**
 * useFileScanner.ts
 *
 * React hook that orchestrates the full scan pipeline:
 *   discover files -> hash -> check duplicate -> extract metadata -> parse filename -> save to Dexie
 *
 * Provides startScan() and cancelScan() to the consuming component,
 * and pushes all progress updates to the Zustand scanner store.
 */

import { useCallback, useRef } from "react";
import { useScannerStore } from "@/stores/scanner-store";
import { db } from "@/lib/db";
import type { Episode } from "@/lib/db/schema";
import { hashFile } from "@/lib/scanner/hasher";
import { extractMetadata } from "@/lib/scanner/metadata";
import { parseFilename } from "@/lib/scanner/filename-parser";
import {
  scanDirectory,
  scanFallback,
  supportsDirectoryPicker,
} from "@/lib/scanner/file-scanner";
import { cacheAudioBlob, isOPFSSupported } from "@/lib/audio/cache";

// ── Helpers ────────────────────────────────────────────────────────────

/** Derive a format string from the file extension. */
function formatFromName(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

// ── Hook ───────────────────────────────────────────────────────────────

export interface UseFileScannerReturn {
  startScan: () => Promise<void>;
  startScanFallback: (fileList: FileList) => Promise<void>;
  cancelScan: () => void;
  supportsNativePicker: boolean;
}

export function useFileScanner(): UseFileScannerReturn {
  const cancelledRef = useRef(false);
  const scanningRef = useRef(false);

  const {
    startScan: storeStartScan,
    updateProgress,
    addError,
    setCompleted,
    setCancelled,
  } = useScannerStore.getState();

  // ── Process a single file through the pipeline ───────────────────────

  const processFile = useCallback(
    async (file: File, scanSessionId: number): Promise<"new" | "duplicate" | "error"> => {
      try {
        // 1. Hash the file for duplicate detection
        const fileHash = await hashFile(file);

        // 2. Check for existing episode with same hash
        const existing = await db.episodes
          .where("fileHash")
          .equals(fileHash)
          .first();

        if (existing) {
          return "duplicate";
        }

        // 3. Extract audio metadata (ID3 tags, duration, etc.)
        const metadata = await extractMetadata(file);

        // 4. Parse the filename for Art Bell-specific info
        const parsed = parseFilename(file.name);

        // 5. Build the Episode record
        const now = Date.now();
        const episode: Episode = {
          fileHash,
          filePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          fileName: file.name,
          fileSize: file.size,

          // Metadata from ID3 tags
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          year: metadata.year ?? (parsed.airDate ? parseInt(parsed.airDate.slice(0, 4), 10) : undefined),

          // Parsed from filename
          airDate: parsed.airDate,
          guestName: parsed.guestName,
          showType: parsed.showType,
          topic: parsed.topic,

          // Audio info
          duration: metadata.duration,
          bitrate: metadata.bitrate,
          sampleRate: metadata.sampleRate,
          format: metadata.format ?? formatFromName(file.name),

          // Playback (defaults)
          playCount: 0,

          // Housekeeping
          scanSessionId,
          createdAt: now,
          updatedAt: now,
        };

        // 6. Save to Dexie
        await db.episodes.add(episode);

        // 7. Cache audio blob to OPFS in background
        if (isOPFSSupported()) {
          cacheAudioBlob(fileHash, file).catch((err) => {
            console.warn(`[scanner] OPFS cache failed for "${file.name}":`, err);
          });
        }

        return "new";
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(`[scanner] Error processing "${file.name}":`, message);
        addError(`${file.name}: ${message}`);
        return "error";
      }
    },
    [addError]
  );

  // ── Run the pipeline over a list of files ────────────────────────────

  const runPipeline = useCallback(
    async (files: File[], rootName: string) => {
      if (scanningRef.current) {
        console.warn("[scanner] Scan already in progress");
        return;
      }

      scanningRef.current = true;
      cancelledRef.current = false;

      // Notify store
      storeStartScan();

      // Create a scan session record
      const scanSessionId = await db.scanSessions.add({
        startedAt: Date.now(),
        rootPath: rootName,
        totalFiles: files.length,
        processedFiles: 0,
        newEpisodes: 0,
        duplicates: 0,
        errors: 0,
        status: "scanning",
      });

      updateProgress({ totalFiles: files.length });

      let newCount = 0;
      let dupCount = 0;
      let errCount = 0;

      for (let i = 0; i < files.length; i++) {
        // Check for cancellation
        if (cancelledRef.current) {
          setCancelled();
          await db.scanSessions.update(scanSessionId, {
            status: "cancelled",
            completedAt: Date.now(),
            processedFiles: i,
            newEpisodes: newCount,
            duplicates: dupCount,
            errors: errCount,
          });
          scanningRef.current = false;
          return;
        }

        const file = files[i];

        // Update current file in store
        updateProgress({
          currentFile: file.name,
          processedFiles: i,
        });

        // Process the file through the pipeline
        const result = await processFile(file, scanSessionId as number);

        switch (result) {
          case "new":
            newCount++;
            updateProgress({ newEpisodes: newCount });
            break;
          case "duplicate":
            dupCount++;
            updateProgress({ duplicates: dupCount });
            break;
          case "error":
            errCount++;
            break;
        }
      }

      // Finalize
      updateProgress({ processedFiles: files.length });
      setCompleted();

      await db.scanSessions.update(scanSessionId, {
        status: "completed",
        completedAt: Date.now(),
        processedFiles: files.length,
        newEpisodes: newCount,
        duplicates: dupCount,
        errors: errCount,
      });

      scanningRef.current = false;
    },
    [storeStartScan, updateProgress, setCompleted, setCancelled, processFile]
  );

  // ── Public: start scan via File System Access API ────────────────────

  const startScan = useCallback(async () => {
    try {
      const { files, rootName } = await scanDirectory();
      await runPipeline(files, rootName);
    } catch (error) {
      // User cancelled the picker, or API error
      if (error instanceof DOMException && error.name === "AbortError") {
        // User cancelled the directory picker -- not an error
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error("[scanner] Scan failed:", message);
      addError(message);
      useScannerStore.getState().updateProgress({ status: "error" });
      scanningRef.current = false;
    }
  }, [runPipeline, addError]);

  // ── Public: start scan via <input webkitdirectory> fallback ──────────

  const startScanFallback = useCallback(
    async (fileList: FileList) => {
      try {
        const files = scanFallback(fileList);
        // Try to derive a root name from webkitRelativePath
        const first = files[0] as File & { webkitRelativePath?: string } | undefined;
        const rootName = first?.webkitRelativePath
          ? first.webkitRelativePath.split("/")[0]
          : "Unknown Directory";

        await runPipeline(files, rootName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[scanner] Fallback scan failed:", message);
        addError(message);
        useScannerStore.getState().updateProgress({ status: "error" });
        scanningRef.current = false;
      }
    },
    [runPipeline, addError]
  );

  // ── Public: cancel a running scan ────────────────────────────────────

  const cancelScan = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  return {
    startScan,
    startScanFallback,
    cancelScan,
    supportsNativePicker: supportsDirectoryPicker(),
  };
}
