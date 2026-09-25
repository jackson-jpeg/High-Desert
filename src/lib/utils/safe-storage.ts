/**
 * Web Storage writes that cannot throw (HD-040).
 *
 * `localStorage.setItem` throws `QuotaExceededError` when the origin is full
 * (the OPFS audio cache shares that quota — src/audio/cache.ts), and merely
 * *reading* `window.localStorage` throws `SecurityError` where storage is
 * blocked (Safari with "Block all cookies", some embedded webviews). Every one
 * of these writes is a convenience — a remembered search, a "seen" flag — and
 * none is worth an unhandled exception in a click handler.
 *
 * Returns whether the value was stored. `src/lib/__tests__/storage-writes.test.ts`
 * fails on a bare `setItem` anywhere else in src/.
 */
export function safeSetItem(area: "local" | "session", key: string, value: string): boolean {
  try {
    (area === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** `removeItem`, on the same terms. */
export function safeRemoveItem(area: "local" | "session", key: string): boolean {
  try {
    (area === "local" ? window.localStorage : window.sessionStorage).removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** `getItem`, on the same terms: `null` when absent *or* unreadable. */
export function safeGetItem(area: "local" | "session", key: string): string | null {
  try {
    return (area === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
