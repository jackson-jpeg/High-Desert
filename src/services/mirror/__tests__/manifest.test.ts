import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hydrateManifest, loadManifest, MANIFEST_STORAGE_KEY, __testing } from "@/services/mirror/manifest";
import { useOutageStore } from "@/stores/outage-store";

/** The client's copy of the mirror's playable set. */

const body = (version: string, fileHashes: string[], etag?: string) =>
  new Response(JSON.stringify({ version, count: fileHashes.length, pinned: fileHashes.length, fileHashes }), {
    headers: etag ? { ETag: etag } : {},
  });

let answer: (init?: RequestInit) => Promise<Response>;
const fetchSpy = vi.fn((_u: string, init?: RequestInit) => answer(init));

beforeEach(() => {
  __testing.reset();
  localStorage.clear();
  useOutageStore.setState({ archiveUp: null, manifest: null, unavailable: null });
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("the mirror manifest, client side", () => {
  it("loads into the store and into localStorage", async () => {
    answer = () => Promise.resolve(body("v1", ["archive:c:a.mp3"]));
    await loadManifest();
    expect(useOutageStore.getState().manifest?.fileHashes.has("archive:c:a.mp3")).toBe(true);
    expect(JSON.parse(localStorage.getItem(MANIFEST_STORAGE_KEY)!).version).toBe("v1");
  });

  it("a page opened during an outage has the last copy before any request", () => {
    localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify({ version: "v9", fileHashes: ["archive:c:b.mp3"] }));
    hydrateManifest();
    expect(useOutageStore.getState().manifest?.version).toBe("v9");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends back the ETag nginx gave it, verbatim, and a 304 keeps what it holds", async () => {
    // nginx's static ETag (mtime-size), deliberately unlike the body's version.
    answer = () => Promise.resolve(body("v1", ["archive:c:a.mp3"], '"66f4a1b2-3c"'));
    await loadManifest();
    answer = () => Promise.resolve(new Response(null, { status: 304 }));
    await loadManifest({ force: true });
    expect((fetchSpy.mock.calls[1][1]?.headers as Record<string, string>)["If-None-Match"]).toBe('"66f4a1b2-3c"');
    expect(useOutageStore.getState().manifest?.version).toBe("v1");
    expect(useOutageStore.getState().manifest?.fileHashes.has("archive:c:a.mp3")).toBe(true);
  });

  it("keeps the ETag across a reload, so the first request of the next page can be a 304", async () => {
    answer = () => Promise.resolve(body("v1", ["archive:c:a.mp3"], 'W/"66f4a1b2-3c"'));
    await loadManifest();
    useOutageStore.setState({ manifest: null });
    __testing.reset();
    hydrateManifest();
    answer = () => Promise.resolve(new Response(null, { status: 304 }));
    await loadManifest();
    expect((fetchSpy.mock.calls[1][1]?.headers as Record<string, string>)["If-None-Match"]).toBe('W/"66f4a1b2-3c"');
  });

  it("holding a copy with no ETag (stored before the change) asks unconditionally", async () => {
    localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify({ version: "v9", fileHashes: ["archive:c:b.mp3"] }));
    hydrateManifest();
    answer = () => Promise.resolve(body("v10", ["archive:c:c.mp3"], '"e"'));
    await loadManifest();
    expect(fetchSpy.mock.calls[0][1]?.headers).toEqual({});
    expect(useOutageStore.getState().manifest?.version).toBe("v10");
  });

  it("is not re-read within its TTL unless forced", async () => {
    answer = () => Promise.resolve(body("v1", []));
    await loadManifest();
    await loadManifest();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await loadManifest({ force: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("an error or a malformed body leaves the store as it was, and never throws", async () => {
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    await expect(loadManifest()).resolves.toBeUndefined();
    answer = () => Promise.resolve(new Response(JSON.stringify({ version: 3 })));
    await loadManifest({ force: true });
    answer = () => Promise.resolve(new Response("bad gateway", { status: 502 }));
    await loadManifest({ force: true });
    expect(useOutageStore.getState().manifest).toBeNull();
  });

  it("corrupt storage is ignored, not fatal", () => {
    localStorage.setItem(MANIFEST_STORAGE_KEY, "{not json");
    expect(() => hydrateManifest()).not.toThrow();
    expect(useOutageStore.getState().manifest).toBeNull();
  });
});
