/**
 * Fetch with retry for transient failures (5xx, network errors, rate limits).
 */

interface RetryOptions {
  retries?: number;
  delay?: number;
  backoff?: number;
  timeout?: number;
}

export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  { retries = 3, delay = 1000, backoff = 2, timeout = 30000 }: RetryOptions = {},
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Timeout: abort if request takes too long
      const controller = new AbortController();
      const existingSignal = options?.signal;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // If caller passed their own signal, forward abort
      if (existingSignal) {
        if (existingSignal.aborted) {
          clearTimeout(timeoutId);
          throw new DOMException("Aborted", "AbortError");
        }
        existingSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

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
      if (err instanceof DOMException && err.name === "AbortError") {
        // Check if it was our timeout or the caller's signal
        if (options?.signal?.aborted) {
          throw err; // Caller cancelled — don't retry
        }
        lastError = new Error("Request timed out");
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, delay * Math.pow(backoff, attempt)));
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}
