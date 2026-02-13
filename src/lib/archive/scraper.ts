import { fetchWithRetry } from "@/lib/utils/retry";
import type { ArchiveSearchResult } from "./types";

export interface ScrapeProgress {
  fetched: number;
  total: number;
  cursor: string | null;
  phase: "idle" | "scraping" | "importing" | "categorizing" | "done" | "error" | "cancelled";
  imported: number;
  duplicates: number;
  categorized: number;
  errors: number;
}

interface ScrapeResponse {
  items: ArchiveSearchResult[];
  cursor: string | null;
  total: number;
}

/**
 * Async generator that scrapes the archive.org catalog in batches.
 * Yields batches of results and updates progress.
 * Optionally resumes from a cursor position.
 */
export async function* scrapeArchiveCatalog(
  signal: AbortSignal,
  onProgress: (update: Partial<ScrapeProgress>) => void,
  resumeCursor?: string | null,
): AsyncGenerator<ArchiveSearchResult[], void, unknown> {
  let cursor: string | null = resumeCursor ?? null;
  let fetched = 0;
  let total = 0;

  onProgress({ phase: "scraping", fetched: 0 });

  do {
    if (signal.aborted) return;

    const params = new URLSearchParams({ count: "100" });
    if (cursor) params.set("cursor", cursor);

    const res = await fetchWithRetry(
      `/api/archive/scrape?${params.toString()}`,
      { signal },
      { retries: 2, delay: 2000 },
    );

    if (!res.ok) {
      throw new Error(`Scrape failed: ${res.status}`);
    }

    const data: ScrapeResponse = await res.json();

    if (data.total > 0 && total === 0) {
      total = data.total;
      onProgress({ total });
    }

    fetched += data.items.length;
    cursor = data.cursor;
    onProgress({ fetched, cursor });

    yield data.items;

    // 1s delay between pages
    if (cursor) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  } while (cursor);
}
