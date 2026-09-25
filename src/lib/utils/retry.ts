/**
 * Fetch with retry for transient failures (5xx, network errors, rate limits).
 */

/**
 * The longest a `Retry-After` is honoured for (HD-040). The header is the
 * server's to set, and a proxy or a misconfigured upstream can send an hour;
 * a listener waiting on a search should be told it failed, not left watching
 * a spinner. Past this the retry happens at the ceiling.
 */
export const MAX_RETRY_AFTER_MS = 30_000;

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
    // Timeout: abort if request takes too long
    const controller = new AbortController();
    const existingSignal = options?.signal;
    const onCallerAbort = () => controller.abort();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      timeoutId = setTimeout(() => controller.abort(), timeout);

      // If caller passed their own signal, forward abort
      if (existingSignal) {
        if (existingSignal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        existingSignal.addEventListener("abort", onCallerAbort, { once: true });
      }

      const res = await fetch(url, { ...options, signal: controller.signal });

      // Rate limited — respect Retry-After header, then retry
      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        const waitMs = retryAfter
          ? Math.min((parseInt(retryAfter, 10) || 10) * 1000, MAX_RETRY_AFTER_MS)
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
    } finally {
      // Settled, whichever way: this attempt's timer and its listener on the
      // caller's signal go with it (HD-040). The listener used to stay, one
      // per attempt, for as long as the caller kept the signal — a scraper's
      // lives for the whole catalog walk — each holding a dead controller.
      clearTimeout(timeoutId);
      existingSignal?.removeEventListener("abort", onCallerAbort);
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, delay * Math.pow(backoff, attempt)));
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}
