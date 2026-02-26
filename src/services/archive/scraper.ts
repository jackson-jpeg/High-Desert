import { fetchWithRetry } from "@/lib/utils/retry";
import { rateLimit } from "@/lib/utils/rate-limit";
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

    // Rate limit: max 5 requests per 10 seconds to prevent archive.org bans
    const rateLimitKey = "archive-scraper";
    let rateLimitResult = rateLimit(rateLimitKey, { maxRequests: 5, windowMs: 10000 });
    
    while (!rateLimitResult.allowed) {
      await new Promise(resolve => setTimeout(resolve, rateLimitResult.retryAfterMs));
      rateLimitResult = rateLimit(rateLimitKey, { maxRequests: 5, windowMs: 10000 });
    }

    const res = await fetchWithRetry(
      `/api/archive/scrape?${params.toString()}`,
      { signal },
      { retries: 3, delay: 3000, backoff: 2 },
    );

    if (!res.ok) {
      throw new Error(`Catalog fetch failed: ${res.status}`);
    }

    const data = (await res.json()) as ScrapeResponse;
    
    // Validate response structure
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response structure from archive.org');
    }
    
    if (!Array.isArray(data.items)) {
      throw new Error('Missing or invalid items array in response');
    }
    
    if (typeof data.page !== 'number' || typeof data.totalPages !== 'number' || typeof data.total !== 'number') {
      throw new Error('Missing or invalid pagination data in response');
    }

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

    // Exponential backoff delay between pages (1-4s based on consecutive errors)
    if (page <= totalPages) {
      const baseDelay = 1000;
      const maxDelay = 4000;
      const delay = Math.min(baseDelay * Math.pow(1.5, Math.floor(fetched / ROWS_PER_PAGE) % 3), maxDelay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
