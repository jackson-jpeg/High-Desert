// @vitest-environment node
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";
import { voterId } from "@/lib/utils/client-key";

/**
 * scripts/migrate-hash-voters.mjs against real Postgres (HD-008).
 *
 * Asserts on what SURVIVES, not only on what is gone: after the migration no
 * voter is an address, every person still has exactly one ballot per episode
 * (their newest), and each episode's average and count are those of the
 * surviving ballots plus whatever the aggregate held that had no ballot row.
 */

const SECRET = "migration-test-secret";
const TAG = `mig${process.pid}`;
const EP = { a: `${TAG}-a`, b: `${TAG}-b`, c: `${TAG}-c` };
const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const IPV6_RE = /[0-9a-f]{0,4}:[0-9a-f]{0,4}:/i;

let pool: pg.Pool;
let migrate: typeof import("../migrate-hash-voters.mjs").migrateHashVoters;

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
  ({ migrateHashVoters: migrate } = await import("../migrate-hash-voters.mjs"));
});

afterAll(async () => {
  if (!pool) return;
  await cleanup();
  await pool.end();
});

async function cleanup() {
  await pool.query("DELETE FROM rating_votes WHERE episode_id LIKE $1", [`${TAG}-%`]);
  await pool.query("DELETE FROM episode_ratings WHERE episode_id LIKE $1", [`${TAG}-%`]);
}

/** A plaintext vote as the pre-HD-008 route wrote it, aggregate included. */
async function legacyVote(voter: string, episode: string, rating: number, minutesAgo: number) {
  await pool.query(
    `INSERT INTO rating_votes (voter, episode_id, rating, updated_at) VALUES ($1, $2, $3, now() - ($4 || ' minutes')::interval)`,
    [voter, episode, rating, String(minutesAgo)],
  );
  await pool.query(
    `INSERT INTO episode_ratings (episode_id, sum, count) VALUES ($1, $2, 1)
     ON CONFLICT (episode_id) DO UPDATE SET sum = episode_ratings.sum + $2, count = episode_ratings.count + 1`,
    [episode, rating],
  );
}

async function run() {
  const client = await pool.connect();
  try {
    return await migrate(client, SECRET);
  } finally {
    client.release();
  }
}

async function ours() {
  const { rows } = await pool.query<{ voter: string; episode_id: string; rating: number }>(
    "SELECT voter, episode_id, rating FROM rating_votes WHERE episode_id LIKE $1 ORDER BY episode_id, voter",
    [`${TAG}-%`],
  );
  return rows;
}

async function aggregate(ep: string) {
  const { rows } = await pool.query("SELECT sum::float AS sum, count::int AS count FROM episode_ratings WHERE episode_id = $1", [ep]);
  return rows[0] as { sum: number; count: number };
}

beforeEach(async () => {
  if (!pool) return;
  await cleanup();
  // Episode a: v4, v6, and an IPv4 with its mapped twin (one person, older vote first).
  await legacyVote("203.0.113.5", EP.a, 5, 30);
  await legacyVote("2001:db8:5:1::1", EP.a, 4, 30);
  await legacyVote("198.51.100.8", EP.a, 1, 20);
  await legacyVote("::ffff:198.51.100.8", EP.a, 3, 10); // newest from that person: 3 survives
  // Episode b: two addresses in one /64 — one household, the newer vote wins.
  await legacyVote("2001:db8:5:2::aaaa", EP.b, 2, 50);
  await legacyVote("2001:db8:5:2::bbbb", EP.b, 5, 5);
  await legacyVote("2001:db8:5:3::1", EP.b, 1, 5); // a different /64: its own ballot
  // Episode c: a plaintext row meets the hashed row the new route wrote for
  // the same person after the deploy. The hashed one is newer and must win.
  await legacyVote("192.0.2.44", EP.c, 2, 60);
  await legacyVote(voterId("192.0.2.44", SECRET), EP.c, 4, 1);
  // An aggregate carrying a vote with no ballot row (imported): must be kept.
  await pool.query("UPDATE episode_ratings SET sum = sum + 5, count = count + 1 WHERE episode_id = $1", [EP.c]);
});

describeDb("migrate-hash-voters (Postgres)", () => {
  it("leaves no plaintext address in rating_votes.voter — v4, v6 and mapped alike", async () => {
    await run();
    const { rows } = await pool.query<{ voter: string }>("SELECT voter FROM rating_votes");
    for (const { voter } of rows) {
      expect(voter).toMatch(/^[0-9a-f]{64}$/);
      expect(voter).not.toMatch(IPV4_RE);
      expect(voter).not.toMatch(IPV6_RE);
    }
  });

  it("keeps each person's newest ballot, once, under the same hash the route writes", async () => {
    await run();
    const want = [
      { voter: voterId("203.0.113.5", SECRET), episode_id: EP.a, rating: 5 },
      { voter: voterId("2001:db8:5:1::1", SECRET), episode_id: EP.a, rating: 4 },
      { voter: voterId("198.51.100.8", SECRET), episode_id: EP.a, rating: 3 },
      { voter: voterId("2001:db8:5:2::ffff", SECRET), episode_id: EP.b, rating: 5 },
      { voter: voterId("2001:db8:5:3::9", SECRET), episode_id: EP.b, rating: 1 },
      { voter: voterId("192.0.2.44", SECRET), episode_id: EP.c, rating: 4 },
    ];
    const key = (r: { voter: string; episode_id: string }) => r.episode_id + r.voter;
    expect(await ours()).toEqual([...want].sort((x, y) => (key(x) < key(y) ? -1 : 1)));
  });

  it("each episode's aggregate is that of what survived", async () => {
    await run();
    // a: 5 + 4 + 3 over 3 ballots (the mapped twin's 1 is backed out).
    expect(await aggregate(EP.a)).toEqual({ sum: 12, count: 3 });
    // b: 5 + 1 over 2 (the older household vote's 2 is backed out).
    expect(await aggregate(EP.b)).toEqual({ sum: 6, count: 2 });
    // c: the surviving 4, plus the imported 5 that never had a ballot row.
    expect(await aggregate(EP.c)).toEqual({ sum: 9, count: 2 });
  });

  it("a second run is a no-op", async () => {
    const first = await run();
    expect(first.merged).toBeGreaterThanOrEqual(3);
    const votes = await ours();
    const aggs = [await aggregate(EP.a), await aggregate(EP.b), await aggregate(EP.c)];

    const second = await run();
    expect(second).toEqual({ plaintext: 0, hashed: 0, merged: 0, episodes: 0 });
    expect(await ours()).toEqual(votes);
    expect([await aggregate(EP.a), await aggregate(EP.b), await aggregate(EP.c)]).toEqual(aggs);
  });

  it("dry run changes nothing", async () => {
    const before = await ours();
    const client = await pool.connect();
    try {
      const r = await migrate(client, SECRET, { dryRun: true });
      expect(r.plaintext).toBeGreaterThanOrEqual(8);
    } finally {
      client.release();
    }
    expect(await ours()).toEqual(before);
    expect(await aggregate(EP.a)).toEqual({ sum: 13, count: 4 });
  });

  it("refuses without a secret, touching nothing", async () => {
    const before = await ours();
    const client = await pool.connect();
    try {
      await expect(migrate(client, "")).rejects.toThrow(/RATING_VOTER_SECRET/);
    } finally {
      client.release();
    }
    expect(await ours()).toEqual(before);
  });
});
