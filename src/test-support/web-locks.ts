/**
 * A faithful-enough `navigator.locks` for tests: exclusive, FIFO per name,
 * shared by everything in the process — the way the real LockManager is shared
 * by every tab of an origin. jsdom has none.
 *
 * Behaves like the real API in the ways the seed lock depends on:
 *   - `request(name, cb)` and `request(name, options, cb)` both work;
 *   - the lock is held until the promise returned by `cb` settles, and
 *     `request` resolves/rejects with that result;
 *   - a waiter's callback does not start until the holder's has settled;
 *   - it is NOT re-entrant: a nested request for a held name waits.
 *
 * `granted` records every grant in order, so a test can see that a second
 * caller really did wait.
 */
export interface FakeLockManager {
  request: LockManager["request"];
  query: () => Promise<LockManagerSnapshot>;
  granted: string[];
}

export function createFakeLockManager(): FakeLockManager {
  const tails = new Map<string, Promise<void>>();
  const granted: string[] = [];

  function request<T>(
    name: string,
    optionsOrCb: LockOptions | ((lock: Lock | null) => T | Promise<T>),
    maybeCb?: (lock: Lock | null) => T | Promise<T>,
  ): Promise<T> {
    const cb = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb!;
    const options = typeof optionsOrCb === "function" ? {} : optionsOrCb;
    if (options.mode && options.mode !== "exclusive") {
      throw new Error("fake LockManager supports exclusive locks only");
    }
    const prev = tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    tails.set(name, prev.then(() => held));

    return prev.then(async () => {
      granted.push(name);
      try {
        return await cb({ name, mode: "exclusive" } as Lock);
      } finally {
        release();
      }
    });
  }

  return {
    request: request as unknown as LockManager["request"],
    query: async () => ({ held: [], pending: [] }),
    granted,
  };
}

/** Install on the global navigator; returns an uninstall function. */
export function installFakeLocks(manager: FakeLockManager | undefined): () => void {
  const had = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { value: manager, configurable: true, writable: true });
  return () => {
    if (had) Object.defineProperty(navigator, "locks", had);
    else delete (navigator as unknown as Record<string, unknown>).locks;
  };
}
