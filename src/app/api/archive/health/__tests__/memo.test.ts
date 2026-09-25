// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, UP_MEMO_MS, DOWN_MEMO_MS, __testing } from "../route";

/** One probe of archive.org serves every tab that polls within the memo. */

let status = 200;
let hang = false;
const upstream = vi.fn(() =>
  hang ? new Promise<Response>(() => {}) : Promise.resolve(new Response(null, { status })),
);

beforeEach(() => {
  __testing.reset();
  vi.useFakeTimers();
  status = 200;
  hang = false;
  upstream.mockClear();
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const up = async () => (await (await GET()).json()).up as boolean;

describe("/api/archive/health", () => {
  it("reuses an up verdict for its memo, then probes again", async () => {
    expect(await up()).toBe(true);
    expect(await up()).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UP_MEMO_MS + 1);
    await up();
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("reuses a down verdict only briefly — never longer than a client's 30 s", async () => {
    status = 503;
    expect(await up()).toBe(false);
    vi.advanceTimersByTime(DOWN_MEMO_MS + 1);
    status = 200;
    expect(await up()).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(DOWN_MEMO_MS).toBeLessThan(30_000);
  });

  it("concurrent requests share the probe in flight", async () => {
    const all = Promise.all([GET(), GET(), GET()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(upstream).toHaveBeenCalledTimes(1);
    await all;
  });

  it("an archive.org that never answers is down after the timeout, and that verdict is shared", async () => {
    hang = true;
    upstream.mockImplementationOnce(
      (_u?: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const first = GET();
    await vi.advanceTimersByTimeAsync(8_001);
    expect((await (await first).json()).up).toBe(false);
    expect(await up()).toBe(false);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
