import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The funnel route takes one step for one recent cohort day and passes it to
 * the store; anything else is a 400 and writes nothing. The store half is
 * funnel.db.test.ts.
 */

const store = vi.hoisted(() => ({
  recordFunnelStep: vi.fn(async () => {}),
  getFunnel: vi.fn(async (days: number) => ({ days, cohorts: [], totals: { visit: 0, live: 0, tune: 0, call: 0 } })),
}));
vi.mock("@/services/stats/store", async () => {
  const funnel = await import("@/services/stats/db/funnel");
  return {
    isFunnelStep: funnel.isFunnelStep,
    isFunnelDevice: funnel.isFunnelDevice,
    isAcceptableCohort: funnel.isAcceptableCohort,
    recordFunnelStep: store.recordFunnelStep,
    getFunnel: store.getFunnel,
  };
});

const { POST, GET } = await import("@/app/api/stats/funnel/route");
const { isAcceptableCohort } = await import("@/services/stats/db/funnel");

let n = 0;
function post(body: unknown, address = `10.8.0.${++n}`) {
  return POST(
    new NextRequest("http://localhost/api/stats/funnel", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": address },
    }),
  );
}

const today = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  store.recordFunnelStep.mockClear();
  store.getFunnel.mockClear();
});

describe("POST /api/stats/funnel", () => {
  it("a known step for today's cohort reaches the store", async () => {
    const res = await post({ step: "tune", cohort: today(), device: "phone" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(store.recordFunnelStep).toHaveBeenCalledWith(today(), "tune", "phone");
  });

  it("an unknown step, or a cohort that is not a recent day, is a 400 and writes nothing", async () => {
    for (const body of [
      { step: "session", cohort: today(), device: "phone" },
      { step: "visit", device: "phone" },
      { step: "visit", cohort: "2026-02-30", device: "phone" },
      { step: "visit", cohort: "yesterday", device: "phone" },
      { step: "visit", cohort: "2020-01-01", device: "phone" },
      { step: "visit", cohort: today() },
      { step: "visit", cohort: today(), device: "tablet" },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(store.recordFunnelStep).not.toHaveBeenCalled();
  });

  it("one client is capped at 10 a minute", async () => {
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await post({ step: "visit", cohort: today(), device: "desktop" }, "10.7.7.7")).status);
    expect(codes.filter((c) => c === 200)).toHaveLength(10);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});

describe("GET /api/stats/funnel", () => {
  it("reads 7, 30 or 90 days, and 7 for anything else", async () => {
    for (const [q, want] of [["30", 30], ["90", 90], ["365", 7], ["", 7]] as const) {
      const res = await GET(new NextRequest(`http://localhost/api/stats/funnel?days=${q}`));
      expect(res.status).toBe(200);
      expect((await res.json()).days).toBe(want);
    }
  });
});

describe("isAcceptableCohort", () => {
  const now = Date.UTC(2026, 8, 27, 12);
  it("takes today, 30 days back, and tomorrow; refuses 31 back and two ahead", () => {
    expect(isAcceptableCohort("2026-09-27", now)).toBe(true);
    expect(isAcceptableCohort("2026-08-28", now)).toBe(true);
    expect(isAcceptableCohort("2026-09-28", now)).toBe(true);
    expect(isAcceptableCohort("2026-08-27", now)).toBe(false);
    expect(isAcceptableCohort("2026-09-29", now)).toBe(false);
  });
});
