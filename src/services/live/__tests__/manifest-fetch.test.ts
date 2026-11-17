import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MANIFEST_MEMO_MS, mirrorManifest, resetManifestForTests } from "@/services/live/manifest";

/**
 * The manifest fetch runs inside frozenDay(), which a Tonight page (ISR,
 * revalidate 3600) can reach when it is first to freeze a day. A
 * `cache: "no-store"` fetch there makes Next answer 500 ("Page changed from
 * static to dynamic at runtime"). So the fetch must be cacheable: a numeric
 * `next.revalidate` and never `no-store`.
 */
describe("the mirror manifest fetch stays static-safe", () => {
  const calls: RequestInit[] = [];
  beforeEach(() => {
    resetManifestForTests();
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return new Response(JSON.stringify({ version: "v1", fileHashes: ["a", "b"] }), { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetManifestForTests();
  });

  it("asks for a 60 s revalidate, not no-store", async () => {
    const m = await mirrorManifest();
    expect(m?.fileHashes).toEqual(new Set(["a", "b"]));
    expect(calls).toHaveLength(1);
    const init = calls[0] as RequestInit & { next?: { revalidate?: number } };
    expect(init.cache).not.toBe("no-store");
    expect(init.next?.revalidate).toBe(MANIFEST_MEMO_MS / 1000);
  });
});
