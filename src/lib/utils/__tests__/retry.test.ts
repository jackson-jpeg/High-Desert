import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "../retry";

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
});
