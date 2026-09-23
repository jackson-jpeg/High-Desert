// @vitest-environment node
import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";

/**
 * One client cannot hold more than SESSIONS_PER_CLIENT sessions in the online
 * count (HD-007). Session ids are minted in the browser, so before this cap a
 * script posting heartbeats with fresh ids could make "online" any number.
 *
 * Against real Postgres: the cap is a read-then-insert under an advisory lock,
 * which is a property of the SQL and the transaction, not of anything a mock
 * could model. Assertions are on the online count the public API serves, and
 * on what survives — the sessions admitted before the cap keep renewing.
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

const TAG = `capdb${process.pid}`;
let seq = 0;
const sid = (label: string) => `${TAG}-${label}-${++seq}`;

afterEach(async () => {
  await store.getPool().query("DELETE FROM active_sessions WHERE session_id LIKE $1", [`${TAG}-%`]);
});

/**
 * This file's share of the online count: exactly the rows getPresence() counts
 * (seen inside the active window), restricted to our session ids so another
 * DB test running in parallel cannot move the number. getPresence() itself is
 * called too, so the rows counted are the rows the public API serves.
 */
async function online(): Promise<number> {
  const presence = await store.getPresence();
  const { rows } = await store.getPool().query<{ n: number }>(
    "SELECT count(*)::int AS n FROM active_sessions WHERE session_id LIKE $1 AND seen_at >= now() - interval '5 minutes'",
    [`${TAG}-%`],
  );
  expect(presence.online).toBeGreaterThanOrEqual(rows[0].n);
  return rows[0].n;
}

describeDb("per-client presence cap (Postgres)", () => {
  it("N+1 sessions from one client raise online by at most N; another client still counts", async () => {
    const N = store.SESSIONS_PER_CLIENT;
    const before = await online();

    const admitted: string[] = [];
    for (let i = 0; i < N + 1; i++) {
      const s = sid("a");
      admitted.push(s);
      // Addresses vary inside one /64: the cap is on the client, not the address.
      await store.recordHeartbeat(s, null, `2001:db8:${TAG.length}:1::/64`);
    }
    expect(await online()).toBe(before + N);

    // A different client is unaffected by the first one's cap.
    await store.recordHeartbeat(sid("b"), null, "198.51.100.77");
    expect(await online()).toBe(before + N + 1);

    // What survives: the N admitted sessions renew; the refused one never appears.
    const { rows } = await store
      .getPool()
      .query<{ session_id: string }>("SELECT session_id FROM active_sessions WHERE session_id = ANY($1)", [admitted]);
    expect(rows.map((r) => r.session_id).sort()).toEqual(admitted.slice(0, N).sort());
    for (const s of admitted.slice(0, N)) await store.recordHeartbeat(s, null, `2001:db8:${TAG.length}:1::/64`);
    expect(await online()).toBe(before + N + 1);
  });

  it("concurrent joins cannot race past the cap", async () => {
    const N = store.SESSIONS_PER_CLIENT;
    const before = await online();
    await Promise.all(
      Array.from({ length: N * 3 }, () => store.recordHeartbeat(sid("race"), null, "203.0.113.99")),
    );
    expect(await online()).toBe(before + N);
  });

  // The recordPlay half of the cap lives in store.db.test.ts: a play writes
  // today's play_events, and the daily-rollup test there counts exactly those,
  // so the two must not run in parallel files.

  it("stores no address: client_ref is an opaque hash", async () => {
    const s = sid("ref");
    await store.recordHeartbeat(s, null, "198.51.100.5");
    const { rows } = await store
      .getPool()
      .query<{ client_ref: string }>("SELECT client_ref FROM active_sessions WHERE session_id = $1", [s]);
    expect(rows[0].client_ref).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].client_ref).not.toContain("198.51.100.5");
  });
});
