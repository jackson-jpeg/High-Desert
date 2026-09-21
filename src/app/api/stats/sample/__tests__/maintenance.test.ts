// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The sampler's maintenance block. `pruneOldWeeks()` existed and was never
 * called, so `weekly_plays` — documented as three weeks of retention — grew
 * forever. The two-minute sampler is the only scheduled writer, so that is
 * where retention runs.
 */

const store = {
  recordSample: vi.fn(),
  rollUpTraffic: vi.fn(),
  anonymizeOldSessions: vi.fn(),
  pruneOldWeeks: vi.fn(),
};
vi.mock("@/services/stats/store", () => store);

const TOKEN = "test-sample-token";

function sample(): NextRequest {
  return new NextRequest("http://localhost/api/stats/sample", {
    method: "POST",
    headers: { "x-sample-token": TOKEN },
  });
}

beforeEach(() => {
  process.env.STATS_SAMPLE_SECRET = TOKEN;
  store.recordSample.mockReset().mockResolvedValue({ online: 3, listening: 1, totalPlays: 10 });
  store.rollUpTraffic.mockReset().mockResolvedValue(3);
  store.anonymizeOldSessions.mockReset().mockResolvedValue(0);
  store.pruneOldWeeks.mockReset().mockResolvedValue(5);
});

describe("POST /api/stats/sample", () => {
  it("prunes old weekly leaderboard rows on every sample", async () => {
    const { POST } = await import("../route");
    const res = await POST(sample());
    expect(res.status).toBe(200);
    expect(store.pruneOldWeeks).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ ok: true, prunedWeeks: 5 });
  });

  it("still prunes when the history rollup fails", async () => {
    store.rollUpTraffic.mockRejectedValue(new Error("rollup down"));
    const { POST } = await import("../route");
    const res = await POST(sample());
    expect(res.status).toBe(200);
    expect(store.pruneOldWeeks).toHaveBeenCalledTimes(1);
  });

  it("does nothing without the token", async () => {
    const { POST } = await import("../route");
    const res = await POST(new NextRequest("http://localhost/api/stats/sample", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(store.pruneOldWeeks).not.toHaveBeenCalled();
  });
});
