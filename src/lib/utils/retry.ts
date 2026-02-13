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

      // Rate limited — respect Retry-After header, then retry
      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        const waitMs = retryAfter
          ? (parseInt(retryAfter, 10) || 10) * 1000
          : delay * Math.pow(backoff, attempt);
        lastError = new Error("Rate limited (429)");
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, Math.max(waitMs, 3000)));
        }
        continue;
      }

      // Don't retry other client errors (4xx)
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
