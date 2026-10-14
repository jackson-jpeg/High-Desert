// @vitest-environment node
import { beforeAll, afterAll, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";
import { pacificDayBounds, requestCloseAt, requestStartAt } from "@/lib/live/schedule";

/**
 * The Request Line as the app reads it (2026-10-14, docs/request-line.md):
 * the night locked by the one function in the database, applied to the
 * station's real frozen day, end to end through `buildSchedule`. On dates far
 * enough out (2099) that nothing else writes them.
 */

type Days = typeof import("../days");
type Requests = typeof import("../requests");
type Pool = typeof import("@/services/stats/db/pool");
let days: Days;
let requests: Requests;
let poolMod: Pool;

const DAY = "2099-06-10";
const REF = (c: string) => c.repeat(64);

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  days = await import("../days");
  requests = await import("../requests");
  poolMod = await import("@/services/stats/db/pool");
  // The chat's schema holds the Request Line's tables and function; idempotent.
  const sql = await readFile(path.resolve(import.meta.dirname, "../../../../services/live/schema.sql"), "utf8");
  const c = await poolMod.pool().connect();
  try {
    await c.query("SELECT pg_advisory_lock(hashtext('live-schema'))");
    await c.query("SET client_min_messages = warning");
    await c.query(sql);
  } finally {
    await c.query("SELECT pg_advisory_unlock(hashtext('live-schema'))").catch(() => {});
    c.release();
  }
});

afterAll(async () => {
  if (!poolMod) return;
  await poolMod.pool().query("DELETE FROM live_request_nights WHERE day >= '2099-01-01'");
  await poolMod.pool().query("DELETE FROM live_request_nominations WHERE day >= '2099-01-01'");
  await poolMod.pool().query("DELETE FROM live_days WHERE day >= '2099-01-01'");
  await poolMod.pool().end();
});

describeDb("the Request Line in the station's schedule (Postgres)", () => {
  it("before 6 PM nothing is locked; after it the most voted pick airs at 10 PM, named, and the rest of the night moves", async () => {
    const catalog = await days.loadCatalog();
    const [pick, runnerUp] = catalog.filter((r) => r.duration && r.duration > 1800 && r.duration < 5400).slice(-2);
    const noon = pacificDayBounds(DAY).start + 12 * 3_600_000;
    const at = (t: number) => new Date(t).toISOString();
    const ins = async (hash: string, ref: string, name: string, place: string | null) =>
      (
        await poolMod
          .pool()
          .query<{ id: string }>(
            `INSERT INTO live_request_nominations (day, file_hash, client_ref, addr_ref, caller_name, caller_place, title, created_at)
             VALUES ($1, $2, $3, $3, $4, $5, 'T', $6) RETURNING id`,
            [DAY, hash, ref, name, place, at(noon)],
          )
      ).rows[0].id;
    const a = await ins(pick.fileHash, REF("a"), "Night Owl", "Pahrump");
    const b = await ins(runnerUp.fileHash, REF("b"), "Day Owl", null);
    const vote = (id: string, ref: string, t: number) =>
      poolMod.pool().query("INSERT INTO live_request_votes (nomination_id, client_ref, addr_ref, at) VALUES ($1, $2, $2, $3)", [id, ref, at(t)]);
    await vote(a, REF("a"), noon);
    await vote(a, REF("c"), noon + 1000);
    await vote(b, REF("b"), noon);
    // Cast after 6 PM: never counted, even though it would make b the winner.
    await vote(b, REF("d"), requestCloseAt(DAY) + 1000);
    await vote(b, REF("e"), requestCloseAt(DAY) + 2000);

    const listed = await requests.loadNominations(DAY);
    expect(listed.map((n) => [n.name, n.votes])).toEqual([
      ["Day Owl", 3],
      ["Night Owl", 2],
    ]);

    expect(await requests.loadRequestNight(DAY, requestCloseAt(DAY) - 1)).toBeNull();
    requests.forgetRequestNightsForTests();
    const night = await requests.loadRequestNight(DAY, requestCloseAt(DAY) + 5000);
    expect(night).toEqual({ day: DAY, fileHash: pick.fileHash, by: "Night Owl", place: "Pahrump", votes: 2 });

    const ctx = async () => ({ archiveDown: false, manifest: null });
    const s = await days.buildSchedule(requestStartAt(DAY) + 60_000, ctx);
    expect(s.now && "slot" in s.now && s.now.slot).toMatchObject({
      fileHash: pick.fileHash,
      kind: "request",
      start: requestStartAt(DAY),
      request: { by: "Night Owl", place: "Pahrump", votes: 2, day: DAY },
    });
    const frozen = await days.frozenDay(DAY);
    const onTheHour = frozen.slots.find((x) => x.requestSlot)!;
    // The show that held 10 PM is still on tonight, after the pick (a pick under 90 minutes leaves it room before midnight).
    expect(s.guide.find((x) => x.fileHash === onTheHour.fileHash && x.start > requestStartAt(DAY))).toBeDefined();
    requests.forgetRequestNightsForTests();
  });

  it("control: a night nobody nominated for leaves the frozen day exactly as it was", async () => {
    const empty = "2099-06-20";
    const night = await requests.loadRequestNight(empty, requestCloseAt(empty) + 1);
    expect(night).toMatchObject({ fileHash: null, votes: 0 });
    const s = await days.buildSchedule(requestStartAt(empty) + 60_000, async () => ({ archiveDown: false, manifest: null }));
    expect(s.guide).toEqual((await days.frozenDay(empty)).slots);
  });
});
