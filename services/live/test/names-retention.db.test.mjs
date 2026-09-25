// @vitest-environment node
import { it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { describeDb } from "../../../src/test-support/test-db.ts";
import { startLive, newCaller, unique, token } from "./helpers.mjs";
import { NAME_CHANGE_MS } from "../lib/config.mjs";

describeDb("caller names", () => {
  let live;
  beforeAll(async () => {
    live = await startLive();
  });
  afterAll(async () => {
    await live?.close();
  });
  const fresh = () => `Night Owl ${token(6)}`;

  it("every caller gets a random name and a line on first contact, and keeps them", async () => {
    const ip = newCaller();
    const a = (await live.get("/live-api/me", { ip })).json;
    expect(a.name).toMatch(/ in | caller|Caller from /);
    expect(a.admin).toBe(false);
    const b = (await live.get("/live-api/me", { ip })).json;
    expect(b.name).toBe(a.name);
    expect(b.line).toBe(a.line);
  });

  it("a caller can choose a name, and it is theirs on the air", async () => {
    const ip = newCaller();
    const name = fresh();
    const r = await live.post("/live-api/name", { name: `  ${name} ` }, { ip });
    expect(r.status).toBe(200);
    expect(r.json.name).toBe(name);
    const m = await live.post("/live-api/messages", { body: unique() }, { ip });
    expect(m.json.name).toBe(name);
  });

  it("names are unique among active callers, case- and punctuation-insensitively", async () => {
    const name = fresh();
    const holder = newCaller();
    expect((await live.post("/live-api/name", { name }, { ip: holder })).status).toBe(200);
    const r = await live.post("/live-api/name", { name: name.toUpperCase().replace(" ", "-") }, { ip: newCaller() });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("taken");
  });

  it("a name held by someone gone for more than 30 minutes is free again", async () => {
    const name = fresh();
    const holder = newCaller();
    expect((await live.post("/live-api/name", { name }, { ip: holder })).status).toBe(200);
    await live.pool.query(`UPDATE live_names SET seen_at = now() - interval '31 minutes' WHERE name = $1`, [name]);
    const taker = newCaller();
    expect((await live.post("/live-api/name", { name }, { ip: taker })).status).toBe(200);
    // The old holder is given a fresh name, not the same one.
    expect((await live.get("/live-api/me", { ip: holder })).json.name).not.toBe(name);
  });

  it("...but not while they are connected, however long ago they were last seen", async () => {
    const name = fresh();
    const holder = newCaller();
    expect((await live.post("/live-api/name", { name }, { ip: holder })).status).toBe(200);
    const s = await live.stream({ ip: holder });
    await s.next("hello");
    await live.pool.query(`UPDATE live_names SET seen_at = now() - interval '2 hours' WHERE name = $1`, [name]);
    expect((await live.post("/live-api/name", { name }, { ip: newCaller() })).status).toBe(409);
    s.close();
  });

  it("can change at most once per 10 minutes", async () => {
    const ip = newCaller();
    expect((await live.post("/live-api/name", { name: fresh() }, { ip })).status).toBe(200);
    const r = await live.post("/live-api/name", { name: fresh() }, { ip });
    expect(r.status).toBe(429);
    expect(r.json.retryAfter).toBeGreaterThan(NAME_CHANGE_MS / 1000 - 30);
    expect(r.json.retryAfter).toBeLessThanOrEqual(NAME_CHANGE_MS / 1000);
    await live.pool.query(
      `UPDATE live_names SET changed_at = now() - interval '11 minutes'
       WHERE client_ref = (SELECT client_ref FROM live_names WHERE name = $1)`,
      [(await live.get("/live-api/me", { ip })).json.name],
    );
    expect((await live.post("/live-api/name", { name: fresh() }, { ip })).status).toBe(200);
  });

  it("the first choice is not held against the random name you were given", async () => {
    const ip = newCaller();
    await live.get("/live-api/me", { ip }); // assigned a random name
    expect((await live.post("/live-api/name", { name: fresh() }, { ip })).status).toBe(200);
  });

  it("names pass the same filter as messages", async () => {
    const ip = newCaller();
    const bad = Buffer.from("c2gxdCBpbiBFbHk=", "base64").toString(); // mild profanity, leet-spelled
    const r = await live.post("/live-api/name", { name: bad }, { ip });
    expect(r.status).toBe(400);
    expect(r.json.reason).toBe("name-profane");
    expect((await live.post("/live-api/name", { name: "visit example.com" }, { ip })).json.reason).toBe("link");
    expect((await live.post("/live-api/name", { name: "Art Bell" }, { ip })).json.reason).toBe("name-reserved");
    // Refusals do not use up the 10-minute change.
    expect((await live.post("/live-api/name", { name: fresh() }, { ip })).status).toBe(200);
  });
});

describeDb("retention", () => {
  let live;
  beforeAll(async () => {
    live = await startLive();
  });
  afterAll(async () => {
    await live?.close();
  });

  it("deletes messages (and their reports) older than 7 days, and nothing newer", async () => {
    const ref = randomBytes(32).toString("hex");
    const ins = (age) =>
      live.pool.query(
        `INSERT INTO live_messages (at, client_ref, caller_name, line, body)
         VALUES (now() - $1::interval, $2, 'Old Caller', 0, 'old') RETURNING id::int`,
        [age, ref],
      );
    const old = (await ins("7 days 1 minute")).rows[0].id;
    const young = (await ins("6 days 23 hours")).rows[0].id;
    await live.pool.query(`INSERT INTO live_reports (message_id, client_ref) VALUES ($1, $2)`, [old, randomBytes(32).toString("hex")]);

    const deleted = await live.app.store.sweep();
    expect(deleted).toBeGreaterThanOrEqual(1);
    const { rows } = await live.pool.query(`SELECT id::int FROM live_messages WHERE client_ref = $1`, [ref]);
    expect(rows.map((r) => r.id)).toEqual([young]);
    const reports = await live.pool.query(`SELECT 1 FROM live_reports WHERE message_id = $1`, [old]);
    expect(reports.rows).toHaveLength(0);
  });

  it("runs on startup, not only on the hourly timer", async () => {
    const ref = randomBytes(32).toString("hex");
    const { rows } = await live.pool.query(
      `INSERT INTO live_messages (at, client_ref, caller_name, line, body)
       VALUES (now() - interval '8 days', $1, 'Old Caller', 0, 'old') RETURNING id::int`,
      [ref],
    );
    const second = await startLive();
    try {
      const left = await second.pool.query(`SELECT 1 FROM live_messages WHERE id = $1`, [rows[0].id]);
      expect(left.rows).toHaveLength(0);
    } finally {
      await second.close();
    }
  });
});
