import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startOutageMonitor, MISS_RETRY_MS } from "@/hooks/useOutageMonitor";
import { clearHealthCache, __testing as health } from "@/services/archive/health";
import { __testing as manifest } from "@/services/mirror/manifest";
import { useOutageStore } from "@/stores/outage-store";

/**
 * The monitor is what makes outage mode start and — the part that used to be
 * a five-minute timer — stop on its own.
 */

let archiveUp = true;
let healthOk = true;
const fetchSpy = vi.fn((url: string) => {
  if (url.includes("/api/archive/health")) {
    return healthOk
      ? Promise.resolve(new Response(JSON.stringify({ up: archiveUp })))
      : Promise.reject(new TypeError("Failed to fetch"));
  }
  if (url.includes("/mirror/manifest")) {
    return Promise.resolve(new Response(JSON.stringify({ version: "v1", fileHashes: ["archive:c:a.mp3"] })));
  }
  return Promise.reject(new Error(`unexpected ${url}`));
});
const calls = (part: string) => fetchSpy.mock.calls.filter(([u]) => u.includes(part)).length;

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

let stop: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  clearHealthCache();
  manifest.reset();
  localStorage.clear();
  useOutageStore.setState({ archiveUp: null, manifest: null, unavailable: null });
  archiveUp = true;
  healthOk = true;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the outage monitor", () => {
  it("probes on start, and re-probes every five minutes while archive.org is up", async () => {
    stop = startOutageMonitor();
    await flush();
    expect(calls("/api/archive/health")).toBe(1);
    expect(useOutageStore.getState().archiveUp).toBe(true);
    await vi.advanceTimersByTimeAsync(health.UP_TTL + 10);
    expect(calls("/api/archive/health")).toBe(2);
    expect(calls("/mirror/manifest")).toBe(0);
  });

  it("an outage beginning mid-visit is noticed, and the manifest is read at once", async () => {
    stop = startOutageMonitor();
    await flush();
    archiveUp = false;
    await vi.advanceTimersByTimeAsync(health.UP_TTL + 10);
    expect(useOutageStore.getState().archiveUp).toBe(false);
    await flush();
    expect(calls("/mirror/manifest")).toBe(1);
    expect(useOutageStore.getState().manifest?.fileHashes.has("archive:c:a.mp3")).toBe(true);
  });

  it("while down, re-probes every thirty seconds — so outage mode ends on its own soon after archive.org returns", async () => {
    archiveUp = false;
    stop = startOutageMonitor();
    await flush();
    expect(useOutageStore.getState().archiveUp).toBe(false);
    archiveUp = true;
    await vi.advanceTimersByTimeAsync(health.DOWN_TTL + 10);
    expect(calls("/api/archive/health")).toBe(2);
    expect(useOutageStore.getState().archiveUp).toBe(true);
  });

  it("a probe that never reached this server is retried, and decides nothing", async () => {
    healthOk = false;
    stop = startOutageMonitor();
    await flush();
    expect(useOutageStore.getState().archiveUp).toBeNull();
    healthOk = true;
    await vi.advanceTimersByTimeAsync(MISS_RETRY_MS + 10);
    expect(useOutageStore.getState().archiveUp).toBe(true);
  });

  it("stops probing when stopped", async () => {
    stop = startOutageMonitor();
    await flush();
    stop();
    await vi.advanceTimersByTimeAsync(health.UP_TTL * 3);
    expect(calls("/api/archive/health")).toBe(1);
  });
});
