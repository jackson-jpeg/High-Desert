/**
 * Cross-tab mutual exclusion for everything that bulk-writes the catalog:
 * the first-visit seed, the doubled-library heal and reconcile.
 *
 * Why: the empty-library check used to run outside any transaction and the
 * `_seedPromise` guard is per tab, so two tabs opened together (or a browser
 * restoring a session) each saw an empty table and each inserted all 1,312 rows
 * (HD-009). The user was left with a permanently doubled library, because the
 * user-initiated dedup correctly refuses to delete 50% of it.
 *
 * Two independent defences, and each is sufficient on its own:
 *
 *   1. This lock (Web Locks API — shared by every tab of the origin), so only
 *      one tab at a time even looks. The waiter then sees the rows the holder
 *      wrote and does nothing, without fetching the catalog at all.
 *   2. Every writer re-checks INSIDE its rw transaction. IndexedDB serialises
 *      rw transactions over the same store, so this holds even where
 *      `navigator.locks` does not exist (Safari < 15.4) — which is why this
 *      falls back to running unlocked rather than refusing to seed.
 *
 * NOT re-entrant, like the real API: never call a locked function from inside
 * another locked function, or the inner request waits forever on the outer.
 */
export const SEED_LOCK = "hd-seed";

export async function withSeedLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== "function") return fn();
  return locks.request(SEED_LOCK, { mode: "exclusive" }, () => fn()) as Promise<T>;
}
