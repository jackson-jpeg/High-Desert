// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { describeDb } from "../../../src/test-support/test-db.ts";
import { startLive, newCaller, unique, token, ORIGIN } from "./helpers.mjs";
import { BUSY_MESSAGES, POST_INTERVAL_MS, SLOW_INTERVAL_MS, FLOOD_CLIENTS } from "../lib/config.mjs";

/**
 * Posting and hearing: the full path through HTTP, Postgres and the SSE hub,
 * with callers identified the way nginx identifies them (X-Forwarded-For from
 * loopback). The clock is injectable so the 3-second rule is tested without
 * waiting three seconds.
 */

describeDb("messages", () => {
  let live;
  let clock = Date.now();
  beforeAll(async () => {
    live = await startLive({ now: () => clock });
  });
  afterAll(async () => {
    await live?.close();
  });
  const tick = (ms) => {
    clock += ms;
  };

  it("one caller's message reaches another caller's stream in under 2 s", async () => {
    const alice = newCaller();
    const bob = newCaller();
    const s = await live.stream({ ip: bob });
    expect(s.status).toBe(200);
    expect(s.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(s.headers.get("x-accel-buffering")).toBe("no");
    const hello = await s.next("hello");
    expect(hello.data.you.name).toBeTruthy();
    expect(hello.data.you.line).toBeTruthy();
    expect(s.raw).toMatch(/^retry: \d+\n\n/);

    const body = unique("hello from the high desert");
    const t0 = Date.now();
    const r = await live.post("/live-api/messages", { body }, { ip: alice });
    expect(r.status).toBe(201);
    const ev = await s.next("message", (d) => d.id === r.json.id, 2_000);
    expect(ev.at - t0).toBeLessThan(2_000);
    expect(ev.data).toMatchObject({ id: r.json.id, body, name: r.json.name, line: r.json.line });
    expect(ev.id).toBe(String(r.json.id));
    // The public shape carries no client ref and no address.
    expect(Object.keys(ev.data).sort()).toEqual(["at", "body", "id", "line", "name"]);
    s.close();
  });

  it("hello carries the recent visible messages; Last-Event-ID resumes after the last one seen", async () => {
    const a = newCaller();
    tick(POST_INTERVAL_MS);
    const first = await live.post("/live-api/messages", { body: unique("first") }, { ip: a });
    tick(POST_INTERVAL_MS);
    const second = await live.post("/live-api/messages", { body: unique("second") }, { ip: a });
    const fresh = await live.stream({ ip: newCaller() });
    const hello = await fresh.next("hello");
    expect(hello.data.resumed).toBe(false);
    expect(hello.data.recent.map((m) => m.id)).toEqual(expect.arrayContaining([first.json.id, second.json.id]));
    fresh.close();

    const resumed = await live.stream({ ip: newCaller(), headers: { "last-event-id": String(first.json.id) } });
    const h2 = await resumed.next("hello");
    expect(h2.data.resumed).toBe(true);
    expect(h2.data.recent.map((m) => m.id)).toContain(second.json.id);
    expect(h2.data.recent.map((m) => m.id)).not.toContain(first.json.id);
    resumed.close();
  });

  it("the stream sends a heartbeat comment", async () => {
    const quick = await startLive({ heartbeatMs: 100 });
    try {
      const s = await quick.stream({ ip: newCaller() });
      await s.next("hello");
      await new Promise((r) => setTimeout(r, 350));
      expect(s.raw).toContain(": ping\n\n");
      s.close();
    } finally {
      await quick.close();
    }
  });

  describe("CSRF", () => {
    it("refuses a POST from another origin, or with no Origin", async () => {
      const ip = newCaller();
      expect((await live.post("/live-api/messages", { body: unique() }, { ip, origin: "https://evil.example" })).status).toBe(403);
      expect((await live.post("/live-api/messages", { body: unique() }, { ip, origin: null })).status).toBe(403);
      expect((await live.post("/live-api/report", { messageId: 1 }, { ip, origin: "http://highdesert.space" })).status).toBe(403);
    });
    it("refuses anything that is not application/json (a form post cannot carry it cross-site)", async () => {
      const ip = newCaller();
      const r = await live.post("/live-api/messages", "body=hi", { ip, type: "application/x-www-form-urlencoded" });
      expect(r.status).toBe(415);
      expect((await live.post("/live-api/messages", "{}", { ip, type: "text/plain" })).status).toBe(415);
    });
    it("accepts the site's own origin", async () => {
      tick(POST_INTERVAL_MS);
      expect((await live.post("/live-api/messages", { body: unique() }, { ip: newCaller(), origin: ORIGIN })).status).toBe(201);
    });
  });

  it("refuses with the reason, and says it in words", async () => {
    const ip = newCaller();
    const r = await live.post("/live-api/messages", { body: "visit example.com" }, { ip });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: "rejected", reason: "link" });
    expect(r.json.message).toMatch(/Links/);
    expect((await live.post("/live-api/messages", { body: "x".repeat(281) }, { ip })).json.reason).toBe("too-long");
    expect((await live.post("/live-api/messages", { body: "   " }, { ip })).json.reason).toBe("empty");
    expect((await live.post("/live-api/messages", { nope: 1 }, { ip })).json.reason).toBe("empty");
    // A refused message does not spend the caller's turn.
    expect((await live.post("/live-api/messages", { body: unique() }, { ip })).status).toBe(201);
  });

  it("masks mild profanity in what the room receives", async () => {
    const s = await live.stream({ ip: newCaller() });
    await s.next("hello");
    const word = Buffer.from("c2hpdA==", "base64").toString();
    const r = await live.post("/live-api/messages", { body: `holy ${word} ${token()}` }, { ip: newCaller() });
    expect(r.status).toBe(201);
    const ev = await s.next("message", (d) => d.id === r.json.id);
    expect(ev.data.body).toMatch(/^holy \*\*\*\* /);
    s.close();
  });

  it("one message per 3 seconds per caller", async () => {
    tick(60_000); // out of any busy window the earlier tests made, so this is the normal pace
    const ip = newCaller();
    expect((await live.post("/live-api/messages", { body: unique() }, { ip })).status).toBe(201);
    tick(POST_INTERVAL_MS - 1_000);
    const r = await live.post("/live-api/messages", { body: unique() }, { ip });
    expect(r.status).toBe(429);
    expect(r.json.retryAfter).toBe(1);
    expect(r.headers.get("retry-after")).toBe("1");
    // Another caller is not held up by this one.
    expect((await live.post("/live-api/messages", { body: unique() }, { ip: newCaller() })).status).toBe(201);
    tick(1_000);
    expect((await live.post("/live-api/messages", { body: unique() }, { ip })).status).toBe(201);
  });

  it("duplicates: the same message twice from one caller, however it is dressed up", async () => {
    const ip = newCaller();
    const body = unique("same thing");
    expect((await live.post("/live-api/messages", { body }, { ip })).status).toBe(201);
    tick(POST_INTERVAL_MS);
    const r = await live.post("/live-api/messages", { body: `  ${body.toUpperCase()}!!! ` }, { ip });
    expect(r.status).toBe(400);
    expect(r.json.reason).toBe("duplicate");
  });

  it("floods: the same long message from many callers is stopped at the third", async () => {
    const body = unique("buy my miracle water");
    const results = [];
    for (let i = 0; i < FLOOD_CLIENTS + 1; i++) {
      results.push((await live.post("/live-api/messages", { body }, { ip: newCaller() })).status);
    }
    expect(results).toEqual([...Array(FLOOD_CLIENTS - 1).fill(201), 400, 400]);
    // Short things everyone says are not a flood.
    const shorts = [];
    for (let i = 0; i < FLOOD_CLIENTS + 1; i++) shorts.push((await live.post("/live-api/messages", { body: "hi art" }, { ip: newCaller() })).status);
    expect(shorts.every((s) => s === 201)).toBe(true);
  });

  it("slow mode turns on by itself when the lines are busy, and the room is told", async () => {
    const own = await startLive({ now: () => clock });
    try {
      const s = await own.stream({ ip: newCaller() });
      const hello = await s.next("hello");
      expect(hello.data.slowMode.on).toBe(false);
      for (let i = 0; i <= BUSY_MESSAGES; i++) {
        expect((await own.post("/live-api/messages", { body: unique(`busy ${i}`) }, { ip: newCaller() })).status).toBe(201);
      }
      const slow = await s.next("slow");
      expect(slow.data).toMatchObject({ on: true, intervalMs: SLOW_INTERVAL_MS, forced: false });
      // In slow mode a caller waits SLOW_INTERVAL_MS, not POST_INTERVAL_MS.
      const ip = newCaller();
      expect((await own.post("/live-api/messages", { body: unique() }, { ip })).status).toBe(201);
      tick(POST_INTERVAL_MS + 100);
      const r = await own.post("/live-api/messages", { body: unique() }, { ip });
      expect(r.status).toBe(429);
      expect(r.json.slowMode).toBe(true);
      s.close();
    } finally {
      await own.close();
    }
  });

  it("stores no address anywhere: the columns, and a round trip", async () => {
    const ip = "203.0.113.77";
    const r = await live.post("/live-api/messages", { body: unique("address check") }, { ip });
    expect(r.status).toBe(201);
    const { rows: cols } = await live.pool.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_name LIKE 'live\\_%'`,
    );
    expect(cols.length).toBeGreaterThan(10);
    expect(cols.filter((c) => /ip|addr|forwarded|host|agent/i.test(c.column_name))).toEqual([]);
    const { rows } = await live.pool.query(
      `SELECT row_to_json(m)::text AS j FROM live_messages m WHERE id = $1
       UNION ALL SELECT row_to_json(n)::text FROM live_names n
         WHERE client_ref = (SELECT client_ref FROM live_messages WHERE id = $1)`,
      [r.json.id],
    );
    expect(rows).toHaveLength(2);
    for (const { j } of rows) {
      expect(j).not.toContain("203.0.113");
      expect(j).toMatch(/"client_ref":"[0-9a-f]{64}"/);
    }
    // The schema refuses an address in a client_ref column outright.
    await expect(
      live.pool.query(`INSERT INTO live_messages (client_ref, caller_name, line, body) VALUES ('203.0.113.77', 'x', 0, 'x')`),
    ).rejects.toThrow(/check constraint/);
  });

  it("health counts connected streams and messages in the last hour", async () => {
    const s = await live.stream({ ip: newCaller() });
    await s.next("hello");
    const h = await live.get("/live-api/health");
    expect(h.status).toBe(200);
    expect(h.json.ok).toBe(true);
    expect(h.json.clients).toBeGreaterThanOrEqual(1);
    expect(h.json.messagesLastHour).toBeGreaterThan(5);
    s.close();
  });
});

describe("the load-test identity header", () => {
  it("is ignored unless LIVE_LOAD_TEST is on", async () => {
    const { createLiveApp } = await import("../lib/app.mjs");
    const fakeReq = (headers) => ({ headers, socket: { remoteAddress: "127.0.0.1" } });
    const pool = { query: async () => ({ rows: [] }), connect: async () => ({}) };
    const off = createLiveApp({ pool, clientSecret: "s".repeat(40), adminToken: "t" });
    const on = createLiveApp({ pool, clientSecret: "s".repeat(40), adminToken: "t", loadTest: true });
    try {
      const a = fakeReq({ "x-forwarded-for": "1.2.3.4", "x-live-test-client": "c1" });
      const b = fakeReq({ "x-forwarded-for": "1.2.3.4", "x-live-test-client": "c2" });
      expect(off.clientRefOf(a)).toBe(off.clientRefOf(b));
      expect(on.clientRefOf(a)).not.toBe(on.clientRefOf(b));
      // ...and only from loopback, even when on.
      const remote = (h) => ({ headers: h, socket: { remoteAddress: "198.51.100.9" } });
      expect(on.clientRefOf(remote({ "x-live-test-client": "c1" }))).toBe(on.clientRefOf(remote({ "x-live-test-client": "c2" })));
    } finally {
      off.close();
      on.close();
    }
  });

  it("X-Forwarded-For is trusted only from loopback", async () => {
    const { createLiveApp } = await import("../lib/app.mjs");
    const pool = { query: async () => ({ rows: [] }), connect: async () => ({}) };
    const app = createLiveApp({ pool, clientSecret: "s".repeat(40), adminToken: "t" });
    try {
      const req = (peer, xff) => ({ headers: { "x-forwarded-for": xff }, socket: { remoteAddress: peer } });
      expect(app.clientRefOf(req("127.0.0.1", "1.1.1.1"))).not.toBe(app.clientRefOf(req("127.0.0.1", "2.2.2.2")));
      expect(app.clientRefOf(req("198.51.100.9", "1.1.1.1"))).toBe(app.clientRefOf(req("198.51.100.9", "2.2.2.2")));
    } finally {
      app.close();
    }
  });
});
