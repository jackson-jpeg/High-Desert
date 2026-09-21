// @vitest-environment node
import { beforeAll, afterAll, it, expect } from "vitest";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";

/**
 * The stats store against a real Postgres (TEST_DATABASE_URL — a *_test
 * database; see src/test-support/test-db.ts). These are properties of the SQL
 * and the connection, which a mocked `pg` cannot have an opinion about.
 */

type Store = typeof import("../store");
let store: Store;

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  store = await import("../store");
});

afterAll(async () => {
  if (store) await store.getPool().end();
});

const TAG = `store-db-test-${process.pid}`;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await store.getPool().query(sql, params)).rows as T[];
}

describeDb("stats store (Postgres)", () => {
  it("caps every statement with a server-side timeout", async () => {
    const [{ statement_timeout }] = await q<{ statement_timeout: string }>("SHOW statement_timeout");
    expect(statement_timeout).toBe(`${store.STATEMENT_TIMEOUT_MS / 1000}s`);
  });

  it("the daily rollup can use the timestamp indexes on play_events and listener_samples", async () => {
    // With sequential scans priced out, the planner uses an index wherever one
    // is *usable*. A predicate that wraps the column in an expression —
    // `(played_at AT TIME ZONE 'UTC')::date >= …` — leaves it no choice but a
    // Seq Scan of a table that is never pruned, every two minutes.
    const client = await store.getPool().connect();
    try {
      await client.query("SET enable_seqscan = off");
      const { rows } = await client.query(`EXPLAIN ${store.ROLLUP_TRAFFIC_SQL}`, [3]);
      const plan = rows.map((r: Record<string, string>) => r["QUERY PLAN"]).join("\n");
      expect(plan).not.toMatch(/Seq Scan on play_events/);
      expect(plan).not.toMatch(/Seq Scan on listener_samples/);
      expect(plan).toMatch(/Index (Only )?Scan[^\n]* on play_events|Bitmap Index Scan on play_events_/);
      expect(plan).toMatch(/Index (Only )?Scan[^\n]* on listener_samples|Bitmap Index Scan on listener_samples_/);
    } finally {
      await client.query("RESET enable_seqscan");
      client.release();
    }
  });

  it("the rollup still buckets plays and samples by UTC day, inclusive of midnight", async () => {
    const [{ today }] = await q<{ today: string }>(
      "SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today",
    );
    const midnight = new Date(`${today}T00:00:00Z`).getTime();
    const day = 86_400_000;
    const iso = (t: number) => new Date(t).toISOString();
    const dayOf = (offset: number) => iso(midnight - offset * day).slice(0, 10);

    // Exactly midnight belongs to the day it starts; a millisecond earlier is
    // the day before. The window is today and the two days before it.
    const instants = [
      midnight, // today
      midnight - 1, // yesterday, 23:59:59.999
      midnight - 2 * day, // first instant of the window
      midnight - 2 * day - 1, // last instant before the window
    ];

    await q("DELETE FROM traffic_daily WHERE day BETWEEN $1::date AND $2::date", [dayOf(3), dayOf(0)]);
    try {
      for (const t of instants) {
        await q("INSERT INTO play_events (episode_id, played_at) VALUES ($1, $2)", [TAG, iso(t)]);
        // Offset samples by 1µs-ish so they never collide with a real sample's primary key.
        await q("INSERT INTO listener_samples (sampled_at, online, listening) VALUES ($1::timestamptz + interval '1 microsecond', 1, 0)", [iso(t)]);
      }

      await store.rollUpTraffic();

      const rows = await q<{ day: string; plays: string; samples: number }>(
        "SELECT to_char(day, 'YYYY-MM-DD') AS day, plays, samples FROM traffic_daily WHERE day BETWEEN $1::date AND $2::date ORDER BY day",
        [dayOf(3), dayOf(0)],
      );
      const byDay = Object.fromEntries(rows.map((r) => [r.day, { plays: Number(r.plays), samples: r.samples }]));

      expect(byDay[dayOf(0)]).toEqual({ plays: 1, samples: 1 });
      expect(byDay[dayOf(1)]).toEqual({ plays: 1, samples: 1 });
      expect(byDay[dayOf(2)]).toEqual({ plays: 1, samples: 1 });
      expect(byDay[dayOf(3)]).toBeUndefined(); // outside the window: not rolled up
    } finally {
      await q("DELETE FROM play_events WHERE episode_id = $1", [TAG]);
      for (const t of instants) {
        await q("DELETE FROM listener_samples WHERE sampled_at = $1::timestamptz + interval '1 microsecond'", [iso(t)]);
      }
      await q("DELETE FROM traffic_daily WHERE day BETWEEN $1::date AND $2::date", [dayOf(3), dayOf(0)]);
    }
  });

  it("pruneOldWeeks deletes weeks past retention and keeps the current one", async () => {
    const current = store.weekKey();
    await q("INSERT INTO weekly_plays (week, episode_id, plays) VALUES ('2020-W01', $1, 1), ($2, $1, 1)", [TAG, current]);
    try {
      const deleted = await store.pruneOldWeeks();
      expect(deleted).toBeGreaterThanOrEqual(1);
      const left = await q<{ week: string }>("SELECT week FROM weekly_plays WHERE episode_id = $1", [TAG]);
      expect(left.map((r) => r.week)).toEqual([current]);
    } finally {
      await q("DELETE FROM weekly_plays WHERE episode_id = $1", [TAG]);
    }
  });
});
