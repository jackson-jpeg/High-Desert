// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A failed catalog read must not be cached for the life of the process.
 *
 * It used to be: `load()` swallowed the error and the empty map it returned
 * was memoised, so one bad read — the seed file mid-deploy, a transient EMFILE
 * — left /api/stats/export and /api/stats/failures without titles until the
 * next restart. Now a failure serves an empty map for CATALOG_RETRY_MS and
 * then reads the file again.
 *
 * Only the filesystem is stubbed, and only for the first read; the second
 * read is the real seed catalog.
 */

const failNext = { count: 0 };

vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  return {
    ...real,
    readFile: (async (...args: Parameters<typeof real.readFile>) => {
      if (failNext.count > 0) {
        failNext.count -= 1;
        throw Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });
      }
      return real.readFile(...args);
    }) as typeof real.readFile,
  };
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ now: new Date("2026-09-21T12:00:00Z"), toFake: ["Date"] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("stats catalog after a failed read", () => {
  it("retries once the retry window has passed", async () => {
    const { catalog, CATALOG_RETRY_MS } = await import("../catalog");

    failNext.count = 1;
    expect((await catalog()).size).toBe(0);

    // Inside the window: no re-read, still empty.
    vi.setSystemTime(Date.now() + CATALOG_RETRY_MS - 1);
    expect((await catalog()).size).toBe(0);

    // Past it: the file is read again, and this time it loads.
    vi.setSystemTime(Date.now() + 2);
    expect((await catalog()).size).toBeGreaterThan(1000);
  });

  it("caches a successful load", async () => {
    const { catalog } = await import("../catalog");
    const first = await catalog();
    failNext.count = 1; // would fail if it read again
    expect(await catalog()).toBe(first);
    failNext.count = 0;
  });
});
