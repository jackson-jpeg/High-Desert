/**
 * The Request Line (2026-10-14, docs/request-line.md), through the real HTTP
 * routes, the real caller cookies and the real lock function in Postgres.
 *
 * Every test runs on its own Pacific day far in the future, so tests (and
 * other test files) never share a night, and the clock is the app's injected
 * one: "6 PM Pacific" is a time the test sets, never the time the test runs.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { startLive, newCaller, TEST_DATABASE_URL } from "./helpers.mjs";
import { heraldText, VOTES_PER_ADDRESS } from "../lib/requests.mjs";
import { pacificDayBounds, requestCloseAt, requestStartAt } from "../lib/shared/pacific.ts";

const d = TEST_DATABASE_URL ? describe : describe.skip;

/** A day of its own: 2041 plus a random offset, so runs never collide. */
let dayN = Math.floor(Math.random() * 300) * 40;
function freshDay() {
  // 40 days apart: one test's locked night never falls in the next one's 30-day window.
  dayN += 40;
  const t = Date.UTC(2041, 0, 1) + dayN * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
/** Noon Pacific on `day`: voting open. */
const noonOf = (day) => pacificDayBounds(day).start + 12 * 3_600_000;

const tag = randomBytes(4).toString("hex");
const SHOWS = Array.from({ length: 6 }, (_, i) => `archive:test-${tag}:show-${i}.mp3`);
const CATALOG = new Map(SHOWS.map((h, i) => [h, { title: `Coast to Coast AM - Test ${i}`, airDate: `1997-0${i + 1}-01`, guestName: `Guest ${i}`, duration: 10_800 }]));
/** The 30-day rule's own shows: its live_days rows must not touch the other tests' days. */
const AIRED = [0, 1, 2].map((i) => `archive:test-${tag}:aired-${i}.mp3`);
for (const h of AIRED) CATALOG.set(h, { title: `Aired ${h.slice(-5)}`, airDate: null, guestName: null, duration: 10_800 });
CATALOG.set(`archive:test-${tag}:empty.mp3`, { title: "Empty", airDate: null, guestName: null, duration: 0 });

/** A note the filter refuses, not written here in plain text (the fixtures' rule). */
const REFUSED = Buffer.from("bmlnZ2VyIGluIEJhcnN0b3c=", "base64").toString("utf8");

d("the Request Line", () => {
  let live;
  let clock = Date.now();
  let onAir = null;
  beforeAll(async () => {
    live = await startLive({
      now: () => clock,
      requests: { heraldMs: false, catalog: async () => CATALOG, onAir: async () => onAir },
    });
    // The app's tables the rule reads (scripts/schema.sql), for a test
    // database that has only the chat's. Same definitions, idempotent.
    await live.pool.query(`CREATE TABLE IF NOT EXISTS live_days (day date PRIMARY KEY, program jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await live.pool.query(
      `CREATE TABLE IF NOT EXISTS audio_checks (file_hash text PRIMARY KEY, ok boolean NOT NULL, reason text, seconds real, segments jsonb, checked_at timestamptz NOT NULL DEFAULT now())`,
    );
  });
  afterAll(async () => {
    if (live) {
      await live.pool.query(`DELETE FROM live_request_nights WHERE day >= '2041-01-01'`);
      await live.pool.query(`DELETE FROM live_request_nominations WHERE file_hash LIKE $1`, [`archive:test-${tag}:%`]);
      await live.pool.query(`DELETE FROM live_days WHERE day >= '2041-01-01'`);
      await live.pool.query(`DELETE FROM audio_checks WHERE file_hash LIKE $1`, [`archive:test-${tag}:%`]);
    }
    await live?.close();
  });

  const nominate = (ip, fileHash, extra = {}) => live.post("/live-api/requests", { fileHash, ...extra }, { ip });
  const vote = (ip, nominationId, o = {}) => live.post("/live-api/requests/vote", { nominationId }, { ip, ...o });
  const state = (ip) => live.get("/live-api/requests", { ip });

  it("a nomination is listed with its nominator's vote, their name and place, and marked as theirs", async () => {
    const day = freshDay();
    clock = noonOf(day);
    const ip = newCaller();
    await live.post("/live-api/place", { place: "Pahrump" }, { ip });
    const r = await nominate(ip, SHOWS[0], { note: "the best one" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ joined: false, votes: 1, day });
    const s = await state(ip);
    expect(s.json.day).toBe(day);
    expect(s.json.closesAt).toBe(requestCloseAt(day));
    expect(s.json.startsAt).toBe(requestStartAt(day));
    expect(s.json.nominated).toBe(true);
    expect(s.json.nominations).toEqual([
      expect.objectContaining({ fileHash: SHOWS[0], title: "Coast to Coast AM - Test 0", place: "Pahrump", note: "the best one", votes: 1, mine: true, voted: true }),
    ]);
    // Someone else sees it, not as theirs.
    const other = await state(newCaller());
    expect(other.json.nominations[0]).toMatchObject({ mine: false, voted: false, votes: 1 });
  });

  it("one nomination per listener per day; nominating a show already up is a vote and spends nothing", async () => {
    const day = freshDay();
    clock = noonOf(day);
    const a = newCaller();
    const b = newCaller();
    expect((await nominate(a, SHOWS[0])).status).toBe(201);
    const second = await nominate(a, SHOWS[1]);
    expect(second.status).toBe(409);
    expect(second.json.error).toBe("already-nominated");
    // b asks for the same show: a vote, and b may still nominate their own.
    const join = await nominate(b, SHOWS[0]);
    expect(join.status).toBe(200);
    expect(join.json).toMatchObject({ joined: true, counted: true, votes: 2 });
    expect((await nominate(b, SHOWS[1])).status).toBe(201);
    // The next day a's nomination is fresh again.
    clock = noonOf(freshDay());
    expect((await nominate(a, SHOWS[1])).status).toBe(201);
  });

  it("one vote per listener per show; a second tap counts nothing", async () => {
    const day = freshDay();
    clock = noonOf(day);
    const r = await nominate(newCaller(), SHOWS[2]);
    const id = r.json.id;
    const v = newCaller();
    expect((await vote(v, id)).json).toMatchObject({ counted: true, votes: 2 });
    expect((await vote(v, id)).json).toMatchObject({ counted: false, votes: 2 });
    // Control: a different listener's vote does count.
    expect((await vote(newCaller(), id)).json).toMatchObject({ counted: true, votes: 3 });
  });

  it(`behind one address at most ${VOTES_PER_ADDRESS} votes count for a show; another address still votes`, async () => {
    const day = freshDay();
    clock = noonOf(day);
    const id = (await nominate(newCaller(), SHOWS[3])).json.id;
    const ip = newCaller();
    for (let i = 0; i < VOTES_PER_ADDRESS; i++) expect((await vote(ip, id, { caller: `${ip}-b${i}` })).status).toBe(200);
    const over = await vote(ip, id, { caller: `${ip}-over` });
    expect(over.status).toBe(429);
    expect(over.json.error).toBe("address-votes");
    expect((await vote(newCaller(), id)).status).toBe(200);
  });

  it("the 6 PM lock: votes after it are refused and never count; the winner is the most voted before it", async () => {
    const day = freshDay();
    clock = noonOf(day);
    const first = (await nominate(newCaller(), SHOWS[0])).json.id;
    const second = (await nominate(newCaller(), SHOWS[1])).json.id;
    await vote(newCaller(), second);
    // 5:59 PM: still open.
    clock = requestCloseAt(day) - 60_000;
    expect((await vote(newCaller(), first)).status).toBe(200);
    // first 2, second 2: a tie goes to the earliest nomination.
    clock = requestCloseAt(day);
    const late = await vote(newCaller(), first);
    expect(late.status).toBe(409);
    expect(late.json.error).toBe("closed");
    const night = await live.app.requests.lockNight(day, clock);
    expect(night).toMatchObject({ day, nominationId: first, fileHash: SHOWS[0], votes: 2 });
    // Locked means locked: a vote written behind the API's back changes nothing.
    await live.pool.query(`INSERT INTO live_request_votes (nomination_id, client_ref, addr_ref) VALUES ($1, $2, $2), ($1, $3, $3)`, [
      second,
      "a".repeat(64),
      "b".repeat(64),
    ]);
    expect((await live.app.requests.lockNight(day, clock + 60_000)).fileHash).toBe(SHOWS[0]);
  });

  it("before 6 PM nothing is locked, and after it a nomination is for tomorrow", async () => {
    const day = freshDay();
    clock = requestCloseAt(day) - 1;
    expect(await live.app.requests.lockNight(day, clock)).toBeNull();
    clock = requestCloseAt(day) + 1;
    const ip = newCaller();
    const r = await nominate(ip, SHOWS[4]);
    expect(r.status).toBe(201);
    expect(r.json.day > day).toBe(true);
    const s = await state(ip);
    expect(s.json.day).toBe(r.json.day);
    // Tonight is locked (nobody nominated for it: an empty night).
    expect(s.json.tonight).toMatchObject({ day, fileHash: null });
  });

  it("the empty night: nobody nominated, so the night locks with no show", async () => {
    const day = freshDay();
    clock = requestCloseAt(day) + 5_000;
    expect(await live.app.requests.lockNight(day, clock)).toMatchObject({ day, fileHash: null, nominationId: null, votes: 0 });
  });

  it("the 30-day rule: a show the station played in the last 30 days, or a past request, cannot be nominated; 31 days back can", async () => {
    const day = freshDay();
    const slot = (h) => ({ slots: [{ fileHash: h, start: 0, end: 1 }], ranking: [] });
    const minus = (n) => new Date(Date.parse(`${day}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    await live.pool.query(`INSERT INTO live_days (day, program) VALUES ($1, $2), ($3, $4) ON CONFLICT DO NOTHING`, [
      minus(30),
      slot(AIRED[0]),
      minus(31),
      slot(AIRED[1]),
    ]);
    await live.pool.query(`INSERT INTO live_request_nights (day, file_hash, caller_name, votes) VALUES ($1, $2, 'x', 1) ON CONFLICT DO NOTHING`, [minus(10), AIRED[2]]);
    clock = noonOf(day);
    const r = await nominate(newCaller(), AIRED[0]);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("played-recently");
    expect(r.json.message).not.toContain("—");
    expect((await nominate(newCaller(), AIRED[2])).json.error).toBe("played-recently");
    // Control: 31 days ago is outside the window.
    expect((await nominate(newCaller(), AIRED[1])).status).toBe(201);
  });

  it("refuses what is not a show the station can play: unknown, no audio, known broken", async () => {
    clock = noonOf(freshDay());
    expect((await nominate(newCaller(), "archive:nope:nothing.mp3")).status).toBe(404);
    expect((await nominate(newCaller(), `archive:test-${tag}:empty.mp3`)).status).toBe(404);
    await live.pool.query(`INSERT INTO audio_checks (file_hash, ok, reason) VALUES ($1, false, 'midstream') ON CONFLICT DO NOTHING`, [SHOWS[5]]);
    expect((await nominate(newCaller(), SHOWS[5])).json.error).toBe("broken-file");
  });

  it("a note goes through the word filter; links are refused like a call", async () => {
    clock = noonOf(freshDay());
    const bad = await nominate(newCaller(), SHOWS[3], { note: REFUSED });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("rejected");
    expect((await nominate(newCaller(), SHOWS[3], { note: "see https://example.com" })).json.reason).toBe("link");
    // Nothing was written by the refusals.
    expect((await nominate(newCaller(), SHOWS[3], { note: "Art at his best" })).status).toBe(201);
  });

  it("an admin veto takes a nomination off; before 10 PM a vetoed winner hands the night to the runner-up", async () => {
    const day = freshDay();
    clock = noonOf(day);
    const top = (await nominate(newCaller(), SHOWS[0])).json.id;
    const next = (await nominate(newCaller(), SHOWS[1])).json.id;
    await vote(newCaller(), top);
    expect((await live.post("/live-api/admin/request-veto", { nominationId: top }, { ip: newCaller() })).status).toBe(401);
    clock = requestCloseAt(day) + 60_000;
    expect((await live.app.requests.lockNight(day, clock)).nominationId).toBe(top);
    const v = await live.admin("request-veto", { nominationId: top });
    expect(v.status).toBe(200);
    expect(v.json).toMatchObject({ day, relocked: true });
    expect((await live.app.requests.lockNight(day, clock)).nominationId).toBe(next);
    // Off the list, and a vote for it is refused.
    const listed = (await live.app.requests.state("c".repeat(64), noonOf(day))).nominations.map((n) => n.id);
    expect(listed).toEqual([next]);
    expect((await vote(newCaller(), top)).status).toBe(410);
  });

  it("the herald: when the request comes on the air the station says so in the lines, once", async () => {
    const day = freshDay();
    clock = noonOf(day);
    const ip = newCaller();
    await live.post("/live-api/place", { place: "Ghent" }, { ip });
    await nominate(ip, SHOWS[4]);
    clock = requestStartAt(day) + 5_000;
    const night = await live.app.requests.lockNight(day, clock);
    const s = await live.stream({ ip: newCaller() });
    await s.next("hello");
    // Something else on the air: nothing said.
    onAir = { kind: "fan-favorite", fileHash: SHOWS[0] };
    expect(await live.app.requests.herald()).toBe(false);
    onAir = { kind: "request", fileHash: SHOWS[4], request: { day, by: night.by, place: "Ghent", votes: 1 } };
    expect(await live.app.requests.herald()).toBe(true);
    const ev = await s.next("station");
    expect(ev.data.text).toBe(heraldText(night.by, "Ghent"));
    expect(ev.data.text).toBe(`Tonight's request, from ${night.by}, calling from Ghent.`);
    // Once: a second look, or a restarted service, says nothing.
    expect(await live.app.requests.herald()).toBe(false);
    s.close();
    onAir = null;
  });

  it("heraldText without a place", () => {
    expect(heraldText("Night Owl", null)).toBe("Tonight's request, from Night Owl.");
    expect(heraldText(null, null)).toBe("Tonight's request, from a listener.");
  });
});
