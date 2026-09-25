import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkArchiveHealth, archiveKnownDown, clearHealthCache, __testing } from "@/services/archive/health";

/**
 * A "down" verdict routes plays to the mirror, so it must be short-lived; and a
 * probe that never reached this server is not a verdict about archive.org.
 */

let answer: () => Promise<Response>;
beforeEach(() => {
  clearHealthCache();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => answer()));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (up: boolean) => () => Promise.resolve(new Response(JSON.stringify({ up })));

describe("archive health cache", () => {
  it("caches up for five minutes", async () => {
    answer = json(true);
    await checkArchiveHealth();
    await checkArchiveHealth();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(__testing.UP_TTL + 1);
    await checkArchiveHealth();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caches down for thirty seconds only — then archiveKnownDown lets go", async () => {
    answer = json(false);
    expect((await checkArchiveHealth()).up).toBe(false);
    expect(archiveKnownDown()).toBe(true);
    vi.advanceTimersByTime(__testing.DOWN_TTL - 1);
    expect(archiveKnownDown()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(archiveKnownDown()).toBe(false);
    expect(__testing.DOWN_TTL).toBeLessThanOrEqual(30_000);
  });

  it("a probe that failed to reach this server caches nothing", async () => {
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    expect((await checkArchiveHealth()).up).toBe(false);
    expect(archiveKnownDown()).toBe(false);
    answer = () => Promise.resolve(new Response("oops", { status: 502 }));
    expect((await checkArchiveHealth()).up).toBe(false);
    expect(archiveKnownDown()).toBe(false);
    answer = json(true);
    expect((await checkArchiveHealth()).up).toBe(true);
  });
});
