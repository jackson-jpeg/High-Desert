// @vitest-environment node
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";

/**
 * The funnel's counters against real Postgres: a step adds one to its own
 * (day, step) and nothing else, a day's steps come back as one cohort row, and
 * the table refuses a step that is not one of the four. Only this file writes
 * funnel_daily, so it owns the rows it reads.
 */

type Store = typeof import("../store");
let store: Store;

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  store = await import("../store");
});

afterAll(async () => {
  if (store) {
    await store.getPool().query("DELETE FROM funnel_daily");
    await store.getPool().end();
  }
});

beforeEach(async () => {
  await store.getPool().query("DELETE FROM funnel_daily");
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describeDb("funnel_daily (Postgres)", () => {
  it("each step adds one to its own day and step, and a day reads as one cohort", async () => {
    const today = daysAgo(0);
    const yesterday = daysAgo(1);
    for (let i = 0; i < 3; i++) await store.recordFunnelStep(today, "visit", "phone");
    await store.recordFunnelStep(today, "live", "phone");
    await store.recordFunnelStep(today, "live", "phone");
    await store.recordFunnelStep(today, "tune", "phone");
    await store.recordFunnelStep(today, "visit", "desktop");
    await store.recordFunnelStep(yesterday, "visit", "desktop");
    await store.recordFunnelStep(yesterday, "call", "desktop");

    const f = await store.getFunnel(7);
    expect(f.days).toBe(7);
    expect(f.cohorts).toEqual([
      { day: yesterday, device: "desktop", visit: 1, live: 0, tune: 0, call: 1, return: 0 },
      { day: today, device: "phone", visit: 3, live: 2, tune: 1, call: 0, return: 0 },
      { day: today, device: "desktop", visit: 1, live: 0, tune: 0, call: 0, return: 0 },
    ]);
    expect(f.totals).toEqual({ visit: 5, live: 2, tune: 1, call: 1, return: 0 });
    expect(f.byDevice).toEqual({
      phone: { visit: 3, live: 2, tune: 1, call: 0, return: 0 },
      desktop: { visit: 2, live: 0, tune: 0, call: 1, return: 0 },
    });
  });

  it("by look: each look's own funnel, while the totals count each browser once", async () => {
    const day = daysAgo(2);
    const zero = { visit: 0, live: 0, tune: 0, call: 0, return: 0 };
    // Three phones arrive in Win98; two tune in, one comes back another day.
    for (let i = 0; i < 3; i++) await store.recordFunnelStep(day, "visit", "phone", "win98");
    await store.recordFunnelStep(day, "tune", "phone", "win98");
    await store.recordFunnelStep(day, "tune", "phone", "win98");
    await store.recordFunnelStep(day, "return", "phone", "win98");
    // One of them switches to Night: its visit and tune count there again.
    await store.recordFunnelStep(day, "visit", "phone", "night", true);
    await store.recordFunnelStep(day, "tune", "phone", "night", true);
    await store.recordFunnelStep(day, "return", "phone", "night", true);
    // An older row, from before looks: in the totals, in no look.
    await store.recordFunnelStep(day, "visit", "phone", null);

    const f = await store.getFunnel(7);
    expect(f.cohorts).toEqual([{ day, device: "phone", ...zero, visit: 4, tune: 2, return: 1 }]);
    expect(f.totals).toEqual({ ...zero, visit: 4, tune: 2, return: 1 });
    expect(f.byLook).toEqual({
      win98: { phone: { ...zero, visit: 3, tune: 2, return: 1 }, desktop: zero },
      night: { phone: { ...zero, visit: 1, tune: 1, return: 1 }, desktop: zero },
    });
  });

  it("the key holds the look: a NULL look is one row, not one per write", async () => {
    await store.recordFunnelStep(daysAgo(0), "visit", "desktop", null);
    await store.recordFunnelStep(daysAgo(0), "visit", "desktop", null);
    await store.recordFunnelStep(daysAgo(0), "visit", "desktop", "night");
    const { rows } = await store.getPool().query("SELECT look, n FROM funnel_daily ORDER BY look NULLS FIRST");
    expect(rows).toEqual([
      { look: null, n: "2" },
      { look: "night", n: "1" },
    ]);
    await expect(
      store.getPool().query("INSERT INTO funnel_daily (day, device, step, look, n) VALUES (current_date, 'phone', 'visit', 'clean', 1)"),
    ).rejects.toThrow(/check constraint/);
  });

  it("the window is the last N days, today included", async () => {
    await store.recordFunnelStep(daysAgo(6), "visit", "phone");
    await store.recordFunnelStep(daysAgo(7), "visit", "phone");
    const f = await store.getFunnel(7);
    expect(f.cohorts.map((c) => c.day)).toEqual([daysAgo(6)]);
  });

  it("the table refuses any other step or device", async () => {
    await expect(
      store.getPool().query("INSERT INTO funnel_daily (day, device, step, n) VALUES (current_date, 'phone', 'session', 1)"),
    ).rejects.toThrow(/check constraint/);
    await expect(
      store.getPool().query("INSERT INTO funnel_daily (day, device, step, n) VALUES (current_date, 'tablet', 'visit', 1)"),
    ).rejects.toThrow(/check constraint/);
  });
});
