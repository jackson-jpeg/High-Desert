// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `?since=` on /api/stats/failures: the fixed window `highdesert-status` uses
 * to hold a release to its baseline (docs/reliability-baseline.md).
 *
 * The window is the seven days from `since`, cut off at now while fewer have
 * passed. Too short and the post-release rate stops counting early; too long
 * and it drifts into a trailing window, which is what it replaces. The SQL is
 * covered against real Postgres in store.db.test.ts; this is the route's
 * choice of bounds, so the store is replaced with a recorder.
 */

const getFailureWindow = vi.fn(async (from: Date, to: Date) => ({
  from: from.toISOString(),
  to: to.toISOString(),
  failures: 2,
  plays: 100,
}));
vi.mock("@/services/stats/store", () => ({
  getFailureRates: async () => [],
  getFailureSummary: async () => ({ failures: 0, recovered: 0, skippedRetries: 0, retriedAndFailed: 0, episodes: 0 }),
  getFailureWindow: (from: Date, to: Date) => getFailureWindow(from, to),
}));
vi.mock("@/services/stats/catalog", () => ({ withEpisodeInfo: async (rows: unknown[]) => rows }));

const { GET } = await import("../route");

const NOW = Date.parse("2026-09-30T12:00:00Z");
const DAY = 86_400_000;
let ip = 0;

function get(query: string) {
  ip += 1;
  return GET(
    new NextRequest(`http://localhost/api/stats/failures${query}`, {
      headers: { "x-forwarded-for": `203.0.113.${ip % 250}` },
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getFailureWindow.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("/api/stats/failures?since=", () => {
  it("a release more than a week old is measured over exactly its first seven days", async () => {
    const since = new Date(NOW - 9 * DAY);
    const res = await get(`?since=${since.toISOString()}`);
    expect(res.status).toBe(200);
    const [from, to] = getFailureWindow.mock.calls[0];
    expect(from.getTime()).toBe(since.getTime());
    expect(to.getTime()).toBe(since.getTime() + 7 * DAY);
    expect((await res.json()).window).toEqual({
      from: since.toISOString(),
      to: new Date(since.getTime() + 7 * DAY).toISOString(),
      failures: 2,
      plays: 100,
    });
  });

  it("a release under a week old is measured up to now", async () => {
    const since = new Date(NOW - 2 * DAY);
    await get(`?since=${since.toISOString()}`);
    expect(getFailureWindow.mock.calls[0][1].getTime()).toBe(NOW);
  });

  it("without since there is no window and the store is not asked", async () => {
    const res = await get("");
    expect(res.status).toBe(200);
    expect((await res.json()).window).toBeUndefined();
    expect(getFailureWindow).not.toHaveBeenCalled();
  });

  it.each(["not-a-date", new Date(NOW + DAY).toISOString()])("rejects since=%s with 400", async (bad) => {
    const res = await get(`?since=${encodeURIComponent(bad)}`);
    expect(res.status).toBe(400);
    expect(getFailureWindow).not.toHaveBeenCalled();
  });
});
