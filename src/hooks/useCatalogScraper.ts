"use client";

import { useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useScraperStore } from "@/stores/scraper-store";
import { runCatalogImport } from "@/services/archive/catalog-import";
import { toast } from "@/stores/toast-store";

/**
 * Thin React wrapper over `runCatalogImport` (`src/services/archive/catalog-import.ts`),
 * which owns the collect/import loop, resume progress and the identity key —
 * kept out of the hook so it can be tested against a real database.
 */
export function useCatalogScraper() {
  // The progress fields, compared shallowly. The whole store used to be
  // subscribed and every callback depended on it, so each progress tick built
  // new startScrape/cancelScrape functions (HD-040). Actions are read with
  // getState() at call time instead: stable, and never a stale `phase`.
  const progress = useScraperStore(
    useShallow((s) => ({
      phase: s.phase,
      fetched: s.fetched,
      total: s.total,
      page: s.page,
      imported: s.imported,
      duplicates: s.duplicates,
      categorized: s.categorized,
      errors: s.errors,
      errorMessages: s.errorMessages,
      startedAt: s.startedAt,
      phaseTimes: s.phaseTimes,
      currentItem: s.currentItem,
    })),
  );
  const abortRef = useRef<AbortController | null>(null);

  const startScrape = useCallback(async (options?: { resume?: boolean }) => {
    const store = useScraperStore.getState();
    if (store.phase !== "idle" && store.phase !== "done" && store.phase !== "error" && store.phase !== "cancelled") {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    store.start();

    try {
      const result = await runCatalogImport(controller.signal, store, { resume: options?.resume });
      // Episodes are imported uncategorised. Batch AI categorisation runs offline
      // via scripts/categorize-library.py and ships in the seed catalog, so no API
      // key or admin token is ever exposed to the browser.
      if (result.outcome === "done") {
        toast.success(`Catalog import complete: ${result.imported} episodes imported`);
      }
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
  }, []);

  const cancelScrape = useCallback(() => {
    abortRef.current?.abort();
    useScraperStore.getState().setPhase("cancelled");
  }, []);

  return {
    ...progress,
    startScrape,
    cancelScrape,
  };
}
