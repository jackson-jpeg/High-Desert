// @vitest-environment node
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";

/**
 * Usage counters against real Postgres (docs/usage-tracking.md): a view and a
 * minute add one to their own (day, tab, device), an arrival adds one to its
 * own (day, source, landing, device), the read sums the window, and a play's
 * surface is stored and counted. Only this file writes route_daily and
 * arrival_daily, so it owns those rows; play_events is shared, so plays are
 * read as a difference.
 */

type Store = typeof import("../store");
let store: Store;

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  store = await import("../store");
});

async function clear() {
  await store.getPool().query("DELETE FROM route_daily");
  await store.getPool().query("DELETE FROM arrival_daily");
}

afterAll(async () => {
  if (store) {
    await clear();
    await store.getPool().query("DELETE FROM play_events WHERE session_ref LIKE 'usage-db-%'");
    await store.getPool().query("DELETE FROM active_sessions WHERE session_id LIKE 'usage-db-%'");
    await store.getPool().end();
  }
});

beforeEach(async () => {
  if (store) await clear();
});

describeDb("usage counters (Postgres)", () => {
  it("views, minutes and arrivals each add one to their own row, and read back summed", async () => {
    await store.recordView("live", "phone", { source: "reddit", landing: "live" });
    await store.recordView("live", "phone", null);
    await store.recordView("library", "phone", null);
    await store.recordView("library", "desktop", { source: "ai", landing: "welcome" });
    await store.recordView("live", "desktop", { source: "reddit", landing: "live" });
    await store.recordRouteMinute("live", "phone");
    await store.recordRouteMinute("live", "phone");
    await store.recordRouteMinute("live", "phone");
    await store.recordRouteMinute("radio", "desktop");
    // A second arrival into the same row.
    await store.recordView("live", "phone", { source: "reddit", landing: "live" });

    const u = await store.getUsage(7);
    expect(u.days).toBe(7);
    expect(u.routes).toEqual([
      { route: "live", device: "phone", views: 3, minutes: 3 },
      { route: "library", device: "desktop", views: 1, minutes: 0 },
      { route: "library", device: "phone", views: 1, minutes: 0 },
      { route: "live", device: "desktop", views: 1, minutes: 0 },
      { route: "radio", device: "desktop", views: 0, minutes: 1 },
    ]);
    expect(u.arrivals).toEqual([
      { source: "reddit", landing: "live", device: "phone", n: 2 },
      { source: "ai", landing: "welcome", device: "desktop", n: 1 },
      { source: "reddit", landing: "live", device: "desktop", n: 1 },
    ]);
  });

  it("the window is the last N UTC days, today included", async () => {
    await store.getPool().query(
      `INSERT INTO route_daily (day, route, device, views, minutes) VALUES
         ((now() AT TIME ZONE 'UTC')::date - 6, 'stats', 'desktop', 5, 50),
         ((now() AT TIME ZONE 'UTC')::date - 7, 'stats', 'desktop', 9, 90)`,
    );
    await store.getPool().query(
      `INSERT INTO arrival_daily (day, source, landing, device, n) VALUES
         ((now() AT TIME ZONE 'UTC')::date - 29, 'google', 'library', 'desktop', 4),
         ((now() AT TIME ZONE 'UTC')::date - 30, 'google', 'library', 'desktop', 8)`,
    );
    expect((await store.getUsage(7)).routes).toEqual([{ route: "stats", device: "desktop", views: 5, minutes: 50 }]);
    expect((await store.getUsage(30)).routes).toEqual([{ route: "stats", device: "desktop", views: 14, minutes: 140 }]);
    expect((await store.getUsage(30)).arrivals).toEqual([{ source: "google", landing: "library", device: "desktop", n: 4 }]);
    expect((await store.getUsage(90)).arrivals).toEqual([{ source: "google", landing: "library", device: "desktop", n: 12 }]);
  });

  it("a play's surface is stored, counted by surface, and an absent one is unknown", async () => {
    const before = (await store.getUsage(7)).playsBySurface;
    const ep = "ultimate-ultimate-art-bell-collection--1997-06-18_-_Coast";
    await store.recordPlay(ep, "usage-db-a1", "203.0.113.71", "archive", null, "radio");
    await store.recordPlay(ep, "usage-db-a2", "203.0.113.72", "archive", null, "radio");
    await store.recordPlay(ep, "usage-db-a3", "203.0.113.73", "mirror", null, "live");
    await store.recordPlay(ep, "usage-db-a4", "203.0.113.74", "archive", null, null);
    const after = (await store.getUsage(7)).playsBySurface;

    const delta = Object.fromEntries(Object.keys(after).map((k) => [k, after[k as keyof typeof after] - before[k as keyof typeof before]]));
    expect(delta).toEqual({
      library: 0,
      radio: 2,
      live: 1,
      stats: 0,
      show: 0,
      palette: 0,
      queue: 0,
      restore: 0,
      other: 0,
      unknown: 1,
    });
    const { rows } = await store.getPool().query(
      "SELECT session_ref, surface FROM play_events WHERE session_ref LIKE 'usage-db-%' ORDER BY session_ref",
    );
    expect(rows).toEqual([
      { session_ref: "usage-db-a1", surface: "radio" },
      { session_ref: "usage-db-a2", surface: "radio" },
      { session_ref: "usage-db-a3", surface: "live" },
      { session_ref: "usage-db-a4", surface: null },
    ]);
  });

  it("the tables refuse anything outside the vocabulary", async () => {
    const q = (sql: string) => store.getPool().query(sql);
    await expect(q("INSERT INTO route_daily (day, route, device) VALUES (current_date, '/library', 'phone')")).rejects.toThrow(/check constraint/);
    await expect(q("INSERT INTO route_daily (day, route, device) VALUES (current_date, 'library', 'tablet')")).rejects.toThrow(/check constraint/);
    await expect(q("INSERT INTO arrival_daily (day, source, landing, device) VALUES (current_date, 'reddit.com', 'live', 'phone')")).rejects.toThrow(/check constraint/);
    await expect(
      q("INSERT INTO play_events (episode_id, surface) VALUES ('usage-db-x', 'https://evil.example')"),
    ).rejects.toThrow(/check constraint/);
  });
});
