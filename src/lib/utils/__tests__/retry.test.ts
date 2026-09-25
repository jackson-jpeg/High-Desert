import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry, MAX_RETRY_AFTER_MS } from "../retry";

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns response on success", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

    const res = await fetchWithRetry("https://example.com");
    expect(res.status).toBe(200);
  });

  it("retries on 5xx and eventually succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await fetchWithRetry("https://example.com", undefined, {
      retries: 2,
      delay: 10,
      backoff: 1,
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("respects 429 Retry-After header", async () => {
    const headers = new Headers({ "Retry-After": "1" });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await fetchWithRetry("https://example.com", undefined, {
      retries: 2,
      delay: 10,
      backoff: 1,
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx client errors", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));

    const res = await fetchWithRetry("https://example.com", undefined, {
      retries: 3,
      delay: 10,
    });

    expect(res.status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws after max retries on persistent 5xx", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("error", { status: 500 }));

    await expect(
      fetchWithRetry("https://example.com", undefined, {
        retries: 2,
        delay: 10,
        backoff: 1,
      }),
    ).rejects.toThrow("HTTP 500");
  });

  it("respects caller abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchWithRetry("https://example.com", { signal: controller.signal }, {
        retries: 3,
        delay: 10,
      }),
    ).rejects.toThrow("Aborted");
  });

  it("leaves no listener on the caller's signal once it settles (HD-040)", async () => {
    // One listener per attempt used to stay on the caller's signal for as
    // long as the caller kept it — the scraper's lives for the whole walk.
    const controller = new AbortController();
    const live = new Set<unknown>();
    const add = controller.signal.addEventListener.bind(controller.signal);
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    vi.spyOn(controller.signal, "addEventListener").mockImplementation((type, fn, opts) => {
      if (type === "abort") live.add(fn);
      add(type, fn, opts);
    });
    vi.spyOn(controller.signal, "removeEventListener").mockImplementation((type, fn, opts) => {
      if (type === "abort") live.delete(fn);
      remove(type, fn, opts);
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await fetchWithRetry("https://example.com", { signal: controller.signal }, {
      retries: 3,
      delay: 10,
      backoff: 1,
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(live.size).toBe(0);
  });

  it("caps an absurd Retry-After at MAX_RETRY_AFTER_MS (HD-040)", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "Retry-After": "3600" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const pending = fetchWithRetry("https://example.com", undefined, { retries: 1, delay: 10 });
    await vi.advanceTimersByTimeAsync(MAX_RETRY_AFTER_MS - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((await pending).status).toBe(200);
    expect(MAX_RETRY_AFTER_MS).toBeLessThanOrEqual(30_000);
  });
});
