// @vitest-environment node
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeDb } from "../../../src/test-support/test-db.ts";
import { testPool } from "./helpers.mjs";
import { createStore } from "../lib/store.mjs";

// Ids leave the database as text (a bigint must not round through a JS
// number). Ordering by that text alias sorted "999" after "1001", so hello
// served the wrong fifty messages as soon as the ids crossed a power of ten.
// Found by the load test. A temporary table shadows live_messages on one
// connection, so the ids here are chosen, not whatever the sequence is at.
describeDb("message order is numeric, not textual", () => {
  let pool;
  let client;
  let store;
  beforeAll(async () => {
    const t = testPool();
    pool = t.pool;
    await t.ready;
    client = await pool.connect();
    await client.query(`CREATE TEMP TABLE live_messages (LIKE public.live_messages INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    for (const id of [998, 999, 1000, 1001]) {
      await client.query(
        `INSERT INTO live_messages (id, client_ref, caller_name, line, body) VALUES ($1, $2, 'Order Test', 0, $3)`,
        [id, "a".repeat(64), `message ${id}`],
      );
    }
    store = createStore(client);
  });
  afterAll(async () => {
    await client?.query("DROP TABLE IF EXISTS pg_temp.live_messages").catch(() => {});
    client?.release();
    await pool?.end();
  });

  it("recentVisible returns the newest by id, oldest first", async () => {
    expect((await store.recentVisible(2)).map((m) => m.id)).toEqual([1000, 1001]);
    expect((await store.recentVisible(10)).map((m) => m.id)).toEqual([998, 999, 1000, 1001]);
  });

  it("visibleAfter catches up in id order across the boundary", async () => {
    expect((await store.visibleAfter(998, 2)).map((m) => m.id)).toEqual([1000, 1001]);
    expect((await store.visibleAfter(998, 10)).map((m) => m.id)).toEqual([999, 1000, 1001]);
  });
});
