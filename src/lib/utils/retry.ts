/**
 * Exponential-backoff retry utility for HTTP requests.
 * Retries on 429 (rate-limit) and 5xx (server) errors.
 */

export interface RetryOptions extends RequestInit {
  timeout?: number;
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
}

/**
 * Fetch wrapper with exponential backoff on rate-limit or server errors.
 * @param url  Request URL
 * @param opts RetryOptions (extends RequestInit)
 * @returns Response or throws after exhausting retries
 */
export async function retryFetch(
  url: string,
  opts: RetryOptions = {}
): Promise<Response> {
  const {
    timeout = 10000,
    maxRetries = 4,
    initialDelay = 1000,
    maxDelay = 16000,
    ...init
  } = opts;

  let attempt = 0;
  let delay = initialDelay;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      // Success or non-retryable client error
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return res;
      }

      // Retryable error
      if (attempt >= maxRetries) {
        return res; // return last response
      }

      const retryAfter = res.headers.get('Retry-After');
      const serverDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0;
      const nextDelay = Math.min(serverDelay || delay, maxDelay);

      await sleep(nextDelay);
      delay = Math.min(delay * 2, maxDelay);
      attempt++;
    } catch (err) {
      clearTimeout(timer);
      // AbortError or network failure
      if (attempt >= maxRetries) {
        throw err;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
      attempt++;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}