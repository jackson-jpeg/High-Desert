// @vitest-environment node
import { beforeAll, afterAll, it, expect } from "vitest";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";

/**
 * The export reads (src/services/stats/db/export.ts) against a real Postgres.
 *
 * getPlayEvents is how sang3r.com pages the permanent log. It pages by id, not
 * by timestamp, because two plays can share one: a cursor that repeats or skips
 * the row on a page boundary double-counts or loses a play for good.
 *
 * Its rows are placed in 2002, offset by pid, so no other suite's rows (the
 * rollup counts today's; getFailureWindow counts 2001) land in the window.
 */

type Store = typeof import("../store");
let store: Store;

const TAG = `export-db-test-${process.pid}`;

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  store = await import("../store");
  // A killed run leaves its rows behind; sweep this suite's own prefix only.
  await store.getPool().query("DELETE FROM play_events WHERE starts_with(episode_id, 'export-db-test-')");
});

afterAll(async () => {
  if (store) await store.getPool().end();
});

describeDb("stats export reads (Postgres)", () => {
  it("mode=daily: visitors and views are null up to each counter's first (partial) day, numbers after", async () => {
    const db = store.getPool();
    const first = async (table: string) =>
      (await db.query<{ d: string | null }>(`SELECT to_char(min(day), 'YYYY-MM-DD') AS d FROM ${table}`)).rows[0].d;
    const v0 = await first("visitor_daily");
    const r0 = await first("route_daily");
    const days = await store.getDailyTraffic(3650);
    expect(days.length).toBeGreaterThan(0);
    for (const d of days) {
      if (v0 === null || d.day <= v0) expect(d.visitors, d.day).toBeNull();
      else expect(typeof d.visitors, d.day).toBe("number");
      if (r0 === null || d.day <= r0) expect(d.views, d.day).toBeNull();
      else expect(typeof d.views, d.day).toBe("number");
    }
  });

  it("mode=detail: the shape sang3r reads, top 10 at most, rates in 0..1", async () => {
    for (const n of store.DETAIL_DAYS) {
      const d = await store.getExportDetail(n);
      expect(d.days).toBe(n);
      for (const list of [d.topPages, d.referrers, d.devices]) {
        expect(list.length).toBeLessThanOrEqual(10);
        for (const e of list) expect(e).toEqual({ name: expect.any(String), count: expect.any(Number) });
      }
      expect(d.countries.length).toBeLessThanOrEqual(10);
      const k = d.keyNumbers;
      expect(k.liveTuneInRate === null || (k.liveTuneInRate >= 0 && k.liveTuneInRate <= 1)).toBe(true);
      expect(k.distinctShows).toBeLessThanOrEqual(k.showsPlayed);
      expect(Object.keys(k.playsBySurface)).toContain("live");
    }
  });

  it("mode=detail counts what the window holds: a play logged today is in showsPlayed (control: removed, it is not)", async () => {
    const before = (await store.getExportDetail(7)).keyNumbers.showsPlayed;
    const { rows } = await store
      .getPool()
      .query<{ id: string }>("INSERT INTO play_events (episode_id, played_at, session_ref) VALUES ($1, now(), 'ref') RETURNING id", [TAG]);
    try {
      expect((await store.getExportDetail(7)).keyNumbers.showsPlayed).toBe(before + 1);
    } finally {
      await store.getPool().query("DELETE FROM play_events WHERE id = $1", [rows[0].id]);
    }
    expect((await store.getExportDetail(7)).keyNumbers.showsPlayed).toBe(before);
  });

  it("getPlayEvents pages the log by id: oldest first, no repeat and no gap at a page boundary", async () => {
    const from = new Date(Date.UTC(2002, 0, 1) + (process.pid % 100_000) * 1000);
    const until = new Date(from.getTime() + 60_000);
    const at = (ms: number) => new Date(from.getTime() + ms).toISOString();
    const insert = async (ms: number) =>
      Number(
        (
          await store.getPool().query<{ id: string }>(
            "INSERT INTO play_events (episode_id, played_at, session_ref) VALUES ($1, $2, 'ref') RETURNING id",
            [TAG, at(ms)],
          )
        ).rows[0].id,
      );

    try {
      // Two plays share a timestamp — the case a timestamp cursor gets wrong.
      const a = await insert(1000);
      const b = await insert(1000);
      const c = await insert(2000);
      await insert(-1); // before `since`
      await insert(60_000); // exactly `until`: the window is half-open

      const page1 = await store.getPlayEvents({ since: from, until, limit: 2 });
      expect(page1.map((e) => e.id)).toEqual([a, b]);
      expect(page1[0]).toEqual({ id: a, episodeId: TAG, at: at(1000), session: "ref" });

      const page2 = await store.getPlayEvents({ since: from, until, afterId: page1[1].id, limit: 2 });
      expect(page2.map((e) => e.id)).toEqual([c]);

      const page3 = await store.getPlayEvents({ since: from, until, afterId: c, limit: 2 });
      expect(page3).toEqual([]);
    } finally {
      await store.getPool().query("DELETE FROM play_events WHERE episode_id = $1", [TAG]);
    }
  });
});
