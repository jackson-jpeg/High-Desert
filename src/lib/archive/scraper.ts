import { fetchWithRetry } from "@/lib/utils/retry";
import type { ArchiveSearchResult } from "./types";

export interface ScrapeProgress {
  fetched: number;
  total: number;
  page: number;
  phase: "idle" | "scraping" | "importing" | "categorizing" | "done" | "error" | "cancelled";
  imported: number;
  duplicates: number;
  categorized: number;
  errors: number;
}

interface ScrapeResponse {
  items: ArchiveSearchResult[];
  page: number;
  totalPages: number;
  total: number;
}

const ROWS_PER_PAGE = 100;

/**
 * Async generator that fetches the archive.org catalog page-by-page
 * using advancedsearch.php. Yields batches of results and updates progress.
 * Optionally resumes from a specific page number.
 */
export async function* scrapeArchiveCatalog(
  signal: AbortSignal,
  onProgress: (update: Partial<ScrapeProgress>) => void,
  resumePage?: number,
): AsyncGenerator<ArchiveSearchResult[], void, unknown> {
  let page = resumePage ?? 1;
  let fetched = 0;
  let totalPages = Infinity;
  let total = 0;

  onProgress({ phase: "scraping", fetched: 0, page });

  while (page <= totalPages) {
    if (signal.aborted) return;

    const params = new URLSearchParams({
      page: String(page),
      rows: String(ROWS_PER_PAGE),
    });

    const res = await fetchWithRetry(
      `/api/archive/scrape?${params.toString()}`,
      { signal },
      { retries: 2, delay: 2000 },
    );

    if (!res.ok) {
      throw new Error(`Catalog fetch failed: ${res.status}`);
    }

    const data: ScrapeResponse = await res.json();

    // Update total on first response (or if it changed)
    if (data.total > 0 && total === 0) {
      total = data.total;
      totalPages = data.totalPages;
      onProgress({ total });
    }

    fetched += data.items.length;
    onProgress({ fetched, page });

    yield data.items;

    page++;

    // Stop if we got an empty page (safety valve)
    if (data.items.length === 0) break;

    // 1s delay between pages
    if (page <= totalPages) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
