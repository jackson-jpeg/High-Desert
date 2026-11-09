// @vitest-environment node
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";

/**
 * Station-sponsor counters against real Postgres (docs/station-breaks.md):
 * each event adds one to its own (day, app, surface, event), the read sums
 * the window per app with zeros for the rest, and the table refuses what is
 * not in the vocabulary. Only this file writes sponsor_daily.
 */

type Db = typeof import("../db/sponsors");
let db: Db;
let pool: typeof import("../db/pool");

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  db = await import("../db/sponsors");
  pool = await import("../db/pool");
});

afterAll(async () => {
  if (db) {
    await pool.pool().query("DELETE FROM sponsor_daily");
    await pool.pool().end();
  }
});

beforeEach(async () => {
  if (db) await pool.pool().query("DELETE FROM sponsor_daily");
});

describeDb("sponsor counters (Postgres)", () => {
  it("adds one per event and reads back per app", async () => {
    await db.recordSponsorEvent("sogojet", "air", "heard");
    await db.recordSponsorEvent("sogojet", "air", "heard");
    await db.recordSponsorEvent("sogojet", "chat", "seen");
    await db.recordSponsorEvent("sogojet", "chat", "click");
    await db.recordSponsorEvent("sogojet", "stats", "click");
    await db.recordSponsorEvent("simsunday", "chat", "mute");
    const t = await db.sponsorTotals(30);
    expect(t.find((r) => r.app === "sogojet")).toEqual({
      app: "sogojet",
      heard: 2,
      seenChat: 1,
      seenStats: 0,
      clicksChat: 1,
      clicksStats: 1,
      mutes: 0,
    });
    expect(t.find((r) => r.app === "simsunday")!.mutes).toBe(1);
    expect(t.find((r) => r.app === "screenreceipts")).toEqual({
      app: "screenreceipts", heard: 0, seenChat: 0, seenStats: 0, clicksChat: 0, clicksStats: 0, mutes: 0,
    });
  });

  it("leaves days outside the window out", async () => {
    await pool.pool().query(
      `INSERT INTO sponsor_daily (day, app, surface, event, n) VALUES ((now() AT TIME ZONE 'UTC')::date - 10, 'sogojet', 'air', 'heard', 5)`,
    );
    expect((await db.sponsorTotals(7)).find((r) => r.app === "sogojet")!.heard).toBe(0);
    expect((await db.sponsorTotals(30)).find((r) => r.app === "sogojet")!.heard).toBe(5);
  });

  it("refuses an app or event outside the vocabulary", async () => {
    await expect(
      pool.pool().query(`INSERT INTO sponsor_daily (day, app, surface, event, n) VALUES (current_date, 'acme', 'air', 'heard', 1)`),
    ).rejects.toThrow();
    await expect(
      pool.pool().query(`INSERT INTO sponsor_daily (day, app, surface, event, n) VALUES (current_date, 'sogojet', 'air', 'liked', 1)`),
    ).rejects.toThrow();
  });
});
