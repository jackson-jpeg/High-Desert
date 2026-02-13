/**
 * Fetch with retry for transient failures (5xx, network errors).
 */

interface RetryOptions {
  retries?: number;
  delay?: number;
  backoff?: number;
}

export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  { retries = 3, delay = 1000, backoff = 2 }: RetryOptions = {},
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);

      // Don't retry client errors (4xx)
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        return res;
      }

      // Server error — retry
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Network error — retry
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, delay * Math.pow(backoff, attempt)));
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}
