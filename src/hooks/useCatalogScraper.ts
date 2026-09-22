"use client";

import { useCallback, useRef } from "react";
import { useScraperStore } from "@/stores/scraper-store";
import { runCatalogImport } from "@/services/archive/catalog-import";
import { toast } from "@/stores/toast-store";

/**
 * Thin React wrapper over `runCatalogImport` (`src/services/archive/catalog-import.ts`),
 * which owns the collect/import loop, resume progress and the identity key —
 * kept out of the hook so it can be tested against a real database.
 */
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
      const result = await runCatalogImport(controller.signal, store, { resume: options?.resume });
      // Episodes are imported uncategorised. Batch AI categorisation runs offline
      // via scripts/categorize-library.py and ships in the seed catalog, so no API
      // key or admin token is ever exposed to the browser.
      if (result.outcome === "done") {
        toast.success(`Catalog import complete — ${result.imported} episodes imported`);
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
