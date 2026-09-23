// @vitest-environment node
import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";
import { voterId } from "@/lib/utils/client-key";
import COMMUNITY_KEYS from "@/data/community-keys.json";

/**
 * /api/stats/rate stores an HMAC of the client, never its address (HD-008),
 * and refuses to store anything when it has no secret to HMAC with.
 *
 * Real route, real store, real Postgres: the property is "what ends up in
 * rating_votes.voter", which only the database can answer.
 */

type Route = typeof import("../route");
type Store = typeof import("@/services/stats/store");
let route: Route;
let store: Store;

const SECRET = "voter-hash-test-secret";
// A real catalog id: the route's allowlist gate runs before anything is stored.
const EPISODE = (COMMUNITY_KEYS as string[])[7];
let xff = 0;

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  store = await import("@/services/stats/store");
  route = await import("../route");
});

afterAll(async () => {
  if (store) await store.getPool().end();
});

/** Snapshot the episode's aggregate so each test can restore it. */
let savedAggregate: { sum: string; count: string } | null = null;
let savedVotes: { voter: string; rating: number }[] = [];
async function snapshot() {
  const { rows } = await store.getPool().query("SELECT sum, count FROM episode_ratings WHERE episode_id = $1", [EPISODE]);
  savedAggregate = rows[0] ?? null;
  savedVotes = (await store.getPool().query("SELECT voter, rating FROM rating_votes WHERE episode_id = $1", [EPISODE])).rows;
}

afterEach(async () => {
  delete process.env.RATING_VOTER_SECRET;
  const pool = store.getPool();
  await pool.query("DELETE FROM rating_votes WHERE episode_id = $1 AND NOT (voter = ANY($2))", [
    EPISODE,
    savedVotes.map((v) => v.voter),
  ]);
  if (savedAggregate) {
    await pool.query("UPDATE episode_ratings SET sum = $2, count = $3 WHERE episode_id = $1", [
      EPISODE,
      savedAggregate.sum,
      savedAggregate.count,
    ]);
  } else {
    await pool.query("DELETE FROM episode_ratings WHERE episode_id = $1", [EPISODE]);
  }
});

function post(ip: string, body: unknown) {
  return route.POST(
    new NextRequest("http://localhost/api/stats/rate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

async function votes(): Promise<{ voter: string; rating: number }[]> {
  const { rows } = await store
    .getPool()
    .query("SELECT voter, rating FROM rating_votes WHERE episode_id = $1 AND NOT (voter = ANY($2))", [
      EPISODE,
      savedVotes.map((v) => v.voter),
    ]);
  return rows;
}

describeDb("/api/stats/rate — voter is an HMAC (Postgres)", () => {
  it("stores HMAC(client /64, secret), and one /64 is one ballot", async () => {
    await snapshot();
    process.env.RATING_VOTER_SECRET = SECRET;
    const ip = `2001:db8:77:${++xff}::1`;

    expect((await post(ip, { episodeId: EPISODE, rating: 4 })).status).toBe(200);
    // Another address in the same /64 re-rates the same ballot, not a new one.
    expect((await post(`2001:db8:77:${xff}::beef`, { episodeId: EPISODE, rating: 2 })).status).toBe(200);

    const rows = await votes();
    expect(rows).toEqual([{ voter: voterId(ip, SECRET), rating: 2 }]);
    expect(rows[0].voter).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].voter).not.toContain("2001:db8");

    // The aggregate reflects the one surviving ballot.
    const r = (await store.getRatings([EPISODE]))[EPISODE];
    const baseCount = Number(savedAggregate?.count ?? 0);
    const baseSum = Number(savedAggregate?.sum ?? 0);
    expect(r.count).toBe(baseCount + 1);
    expect(r.avg).toBe(Number(((baseSum + 2) / (baseCount + 1)).toFixed(2)));
  });

  it("removal finds the hashed ballot", async () => {
    await snapshot();
    process.env.RATING_VOTER_SECRET = SECRET;
    const ip = `198.51.100.${(++xff % 200) + 1}`;
    await post(ip, { episodeId: EPISODE, rating: 5 });
    expect(await votes()).toHaveLength(1);
    expect((await post(ip, { episodeId: EPISODE, rating: null })).status).toBe(200);
    expect(await votes()).toHaveLength(0);
  });

  it("without RATING_VOTER_SECRET it refuses with 503 and stores nothing", async () => {
    await snapshot();
    delete process.env.RATING_VOTER_SECRET;
    const res = await post(`203.0.113.${(++xff % 200) + 1}`, { episodeId: EPISODE, rating: 3 });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Ratings unavailable" });
    expect(await votes()).toEqual([]);
  });

  it("the store itself refuses a plaintext voter", async () => {
    await expect(store.recordRating(EPISODE, 3, "203.0.113.9")).rejects.toThrow(/HMAC/);
    expect(await votes()).toEqual([]);
  });
});
