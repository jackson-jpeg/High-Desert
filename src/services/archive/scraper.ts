import { fetchWithRetry } from "@/lib/utils/retry";
import { rateLimit } from "@/lib/utils/rate-limit";
import { toastStore } from "@/stores/toast-store";
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

    let res;
    try {
      res = await fetchWithRetry(
        `/api/archive/scrape?${params.toString()}`,
        { signal },
        { retries: 5, delay: 5000, backoff: 2 },
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          toastStore.getState().addToast({
            type: 'error',
            title: 'Connection Error',
            message: 'Unable to connect to archive.org. Please check your internet connection.',
          });
        } else {
          toastStore.getState().addToast({
            type: 'error',
            title: 'Network Error',
            message: 'Failed to fetch catalog data. Please try again.',
          });
        }
      }
      onProgress({ phase: 'error' });
      throw error;
    }

    if (!res.ok) {
      let errorMessage = 'Failed to fetch catalog data';
      
      if (res.status === 429) {
        errorMessage = 'Archive.org is rate limiting requests. Please wait a moment and try again.';
        toastStore.getState().addToast({
          type: 'warning',
          title: 'Rate Limited',
          message: errorMessage,
        });
      } else if (res.status >= 500 && res.status < 600) {
        errorMessage = 'Archive.org is temporarily unavailable. Please try again later.';
        toastStore.getState().addToast({
          type: 'error',
          title: 'Server Error',
          message: errorMessage,
        });
      } else if (res.status === 0) {
        errorMessage = 'CORS or network error. This might be a browser security restriction.';
        toastStore.getState().addToast({
          type: 'error',
          title: 'Network Error',
          message: errorMessage,
        });
      } else {
        errorMessage = `Archive request failed (${res.status}). Please try again.`;
        toastStore.getState().addToast({
          type: 'error',
          title: 'Request Failed',
          message: errorMessage,
        });
      }
      
      onProgress({ phase: 'error' });
      throw new Error(`Catalog fetch failed: ${res.status} - ${errorMessage}`);
    }

    const data = (await res.json()) as ScrapeResponse;
    
    // Validate response structure
    if (!data || typeof data !== 'object') {
      toastStore.getState().addToast({
        type: 'error',
        title: 'Invalid Response',
        message: 'Archive.org returned invalid data format. Please try again.',
      });
      onProgress({ phase: 'error' });
      throw new Error('Invalid response structure from archive.org');
    }
    
    if (!Array.isArray(data.items)) {
      toastStore.getState().addToast({
        type: 'error',
        title: 'Invalid Response',
        message: 'Archive.org response missing episode data. Please try again.',
      });
      onProgress({ phase: 'error' });
      throw new Error('Missing or invalid items array in response');
    }
    
    if (typeof data.page !== 'number' || typeof data.totalPages !== 'number' || typeof data.total !== 'number') {
      toastStore.getState().addToast({
        type: 'error',
        title: 'Invalid Response',
        message: 'Archive.org response missing pagination data. Please try again.',
      });
      onProgress({ phase: 'error' });
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
