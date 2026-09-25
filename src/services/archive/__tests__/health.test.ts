import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkArchiveHealth, archiveKnownDown, clearHealthCache, msUntilReprobe, __testing } from "@/services/archive/health";
import { useOutageStore } from "@/stores/outage-store";

/**
 * A "down" verdict routes plays to the mirror, so it must be short-lived; and a
 * probe that never reached this server is not a verdict about archive.org.
 */

let answer: () => Promise<Response>;
beforeEach(() => {
  clearHealthCache();
  useOutageStore.setState({ archiveUp: null, manifest: null, unavailable: null });
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

  it("caches down for thirty seconds only — then re-probes, and an up verdict ends outage mode", async () => {
    answer = json(false);
    expect((await checkArchiveHealth()).up).toBe(false);
    expect(archiveKnownDown()).toBe(true);
    expect(useOutageStore.getState().archiveUp).toBe(false);
    vi.advanceTimersByTime(__testing.DOWN_TTL - 1);
    await checkArchiveHealth();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(msUntilReprobe()).toBe(1);
    vi.advanceTimersByTime(2);
    expect(msUntilReprobe()).toBe(0);
    answer = json(true);
    expect((await checkArchiveHealth()).up).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(archiveKnownDown()).toBe(false);
    expect(useOutageStore.getState().archiveUp).toBe(true);
    expect(__testing.DOWN_TTL).toBeLessThanOrEqual(30_000);
  });

  it("holds a down verdict between probes, so a start agrees with the banner", async () => {
    answer = json(false);
    await checkArchiveHealth();
    vi.advanceTimersByTime(__testing.DOWN_TTL + 5_000);
    expect(archiveKnownDown()).toBe(true);
  });

  it("a probe that failed to reach this server caches nothing", async () => {
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    expect((await checkArchiveHealth()).up).toBe(false);
    expect(archiveKnownDown()).toBe(false);
    expect(useOutageStore.getState().archiveUp).toBeNull();
    answer = () => Promise.resolve(new Response("oops", { status: 502 }));
    expect((await checkArchiveHealth()).up).toBe(false);
    expect(archiveKnownDown()).toBe(false);
    expect(useOutageStore.getState().archiveUp).toBeNull();
    answer = json(true);
    expect((await checkArchiveHealth()).up).toBe(true);
  });
});
