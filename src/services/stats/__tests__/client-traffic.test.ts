import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchTraffic } from "../client";

/**
 * `fetchTraffic` against the response shapes it can actually meet. A server
 * from before per-bucket maxima sends only the means; the chart draws
 * `onlineMax`, so without the fallback that deploy window would draw a flat
 * zero line under a non-zero headline.
 */

function answer(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchTraffic", () => {
  it("keeps the server's maxima when it sends them", async () => {
    answer({
      range: "24h",
      points: [{ t: "2026-09-25T00:00:00.000Z", online: 2, listening: 1, onlineMax: 9, listeningMax: 4, plays: 0 }],
      peakOnline: 9,
      peakListening: 4,
    });
    const t = await fetchTraffic("24h");
    expect(t?.points[0]).toMatchObject({ online: 2, listening: 1, onlineMax: 9, listeningMax: 4 });
  });

  it("falls back to the means from a server that predates the maxima", async () => {
    answer({
      range: "24h",
      points: [{ t: "2026-09-25T00:00:00.000Z", online: 3, listening: 2, plays: 0 }],
      peakOnline: 3,
      peakListening: 2,
    });
    const t = await fetchTraffic("24h");
    expect(t?.points[0]).toMatchObject({ onlineMax: 3, listeningMax: 2 });
  });
});
