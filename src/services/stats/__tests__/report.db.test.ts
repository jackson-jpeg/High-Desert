// @vitest-environment node
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";

/**
 * The ratings report against real Postgres (UI plan push 6, batch 4). Only
 * this file writes play_finishes; it clears what it writes elsewhere by its
 * own episode ids and markers.
 */

type Db = typeof import("../db/report");
let db: Db;
let pool: typeof import("../db/pool");
const q = (sql: string, args: unknown[] = []) => pool.pool().query(sql, args);

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  db = await import("../db/report");
  pool = await import("../db/pool");
});

async function clear() {
  await q("DELETE FROM play_finishes");
  await q("DELETE FROM play_events WHERE episode_id LIKE 'rpt-%'");
  await q("DELETE FROM listener_samples WHERE sampled_at >= '2098-01-01' AND sampled_at < '2099-01-01'");
  await q("DELETE FROM traffic_daily WHERE day >= '2098-01-01' AND day < '2099-01-01'");
  await q("DELETE FROM play_events WHERE played_at >= '2098-01-01' AND played_at < '2099-01-01'");
  await q("DELETE FROM visitors WHERE id LIKE 'rpt-visitor-%'");
}

afterAll(async () => {
  if (db) {
    await clear();
    await pool.pool().end();
  }
});
beforeEach(async () => {
  if (db) await clear();
});

/** Every test but the first reads the report as of this instant, on rows of its own. */
const NOW = new Date("2098-06-15T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;
const DAY = 24 * H;

describeDb("ratings report (Postgres)", () => {
  it("Most finished: finishes over plays since FINISHES_SINCE, shows under the play floor left out", async () => {
    const at = "2026-12-01T12:00:00Z";
    const before = "2026-11-20T12:00:00Z";
    for (let i = 0; i < 5; i++) await q("INSERT INTO play_events (episode_id, played_at) VALUES ('rpt-a', $1)", [at]);
    for (let i = 0; i < 4; i++) await q("INSERT INTO play_finishes (episode_id, finished_at) VALUES ('rpt-a', $1)", [at]);
    for (let i = 0; i < 10; i++) await q("INSERT INTO play_events (episode_id, played_at) VALUES ('rpt-b', $1)", [at]);
    for (let i = 0; i < 3; i++) await q("INSERT INTO play_finishes (episode_id, finished_at) VALUES ('rpt-b', $1)", [at]);
    // Plays before finishes were counted do not dilute the share.
    for (let i = 0; i < 50; i++) await q("INSERT INTO play_events (episode_id, played_at) VALUES ('rpt-b', $1)", [before]);
    // Four plays: under the floor.
    for (let i = 0; i < 4; i++) await q("INSERT INTO play_events (episode_id, played_at) VALUES ('rpt-c', $1)", [at]);
    await q("INSERT INTO play_finishes (episode_id, finished_at) VALUES ('rpt-c', $1)", [at]);
    // Before FINISHES_SINCE: stored, and not counted in the share. A fixed
    // date, never "today": this read "today" until 2026-11-28, which is
    // FINISHES_SINCE itself, and the test broke on that day.
    await q("INSERT INTO play_finishes (episode_id, finished_at) VALUES ('rpt-a', $1)", [before]);
    // recordFinish stores a row (now); it is taken out again so the report's instant decides alone.
    await db.recordFinish("rpt-a");
    expect((await q("SELECT count(*)::int AS n FROM play_finishes WHERE episode_id = 'rpt-a'")).rows[0].n).toBe(6);
    await q("DELETE FROM play_finishes WHERE episode_id = 'rpt-a' AND finished_at BETWEEN now() - interval '5 minutes' AND now() + interval '5 minutes'");
    const r = await db.getRatingsReport(new Date("2026-12-02T00:00:00Z"));
    expect(r.finished.entries.map((e) => [e.episodeId, e.plays, e.finishes])).toEqual([
      ["rpt-a", 5, 4],
      ["rpt-b", 10, 3],
    ]);
    expect(r.finished.entries[0].share).toBe(0.8);
  });

  it("crowd: the last 12 hours' peak against the median daily peak, and null under 7 days", async () => {
    await q("INSERT INTO listener_samples (sampled_at, online) VALUES ($1, 9), ($2, 50)", [ago(H), ago(20 * H)]);
    const day = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString().slice(0, 10);
    for (let d = 1; d <= 6; d++) await q("INSERT INTO traffic_daily (day, peak_online, samples) VALUES ($1, $2, 10)", [day(d), d]);
    expect((await db.getRatingsReport(NOW)).crowd).toBeNull();
    await q("INSERT INTO traffic_daily (day, peak_online, samples) VALUES ($1, 7, 10)", [day(7)]);
    // Today's row is not a typical day.
    await q("INSERT INTO traffic_daily (day, peak_online, samples) VALUES ($1, 99, 10)", [day(0)]);
    expect((await db.getRatingsReport(NOW)).crowd).toEqual({ peak: 9, typical: 4, days: 7 });
  });

  it("Most played this week: the last 7 days, 2 plays at least, most first (the first is the hottest)", async () => {
    await q("INSERT INTO play_events (episode_id, played_at) VALUES ('rpt-old', $1), ('rpt-old', $1), ('rpt-old', $1)", [ago(8 * DAY)]);
    await q("INSERT INTO play_events (episode_id, played_at) VALUES ('rpt-one', $1)", [ago(H)]);
    expect((await db.getRatingsReport(NOW)).week).toEqual([]);
    await q("INSERT INTO play_events (episode_id, played_at) VALUES ('rpt-hot', $1), ('rpt-hot', $1)", [ago(H)]);
    await q("INSERT INTO play_events (episode_id, played_at) VALUES ('rpt-hotter', $1), ('rpt-hotter', $1), ('rpt-hotter', $1)", [ago(2 * H)]);
    expect((await db.getRatingsReport(NOW)).week).toEqual([
      { episodeId: "rpt-hotter", plays: 3 },
      { episodeId: "rpt-hot", plays: 2 },
    ]);
  });

  it("new states: US states whose first browser came this week", async () => {
    const v = (n: number, region: string, ms: number, country = "US") =>
      q(`INSERT INTO visitors (id, device, country, region, first_seen) VALUES ($1, 'phone', $2, $3, $4)`, [`rpt-visitor-${String(n).padStart(8, "0")}`, country, region, ago(ms)]);
    await v(1, "Wyoming", 2 * DAY);
    await v(2, "Vermont", 30 * DAY);
    await v(3, "Vermont", DAY);
    await v(4, "Bavaria", DAY, "DE");
    const r = await db.getRatingsReport(NOW);
    expect(r.newStates).toEqual(["Wyoming"]);
    expect(r.newStates).not.toContain("Vermont");
    expect(r.newStates).not.toContain("Bavaria");
  });
});
