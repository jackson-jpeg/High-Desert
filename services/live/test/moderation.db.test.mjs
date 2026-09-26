// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { describeDb } from "../../../src/test-support/test-db.ts";
import { startLive, newCaller, unique, token } from "./helpers.mjs";
import { sha256hex, sessionValue, verifySession } from "../lib/admin.mjs";
import { ADMIN_COOKIE, REPORT_MUTE_MS } from "../lib/config.mjs";

/** Reports, mutes, bans, and the admin credential. */

let clock = Date.now();
const tick = (ms = 5_000) => {
  clock += ms;
};

describeDb("reports", () => {
  let live;
  beforeAll(async () => {
    live = await startLive({ now: () => clock });
  });
  afterAll(async () => {
    await live?.close();
  });

  it("three reports from different callers hide the message and mute its sender for 10 minutes", async () => {
    const troll = newCaller();
    const s = await live.stream({ ip: newCaller() });
    await s.next("hello");
    const m = await live.post("/live-api/messages", { body: unique("reportable") }, { ip: troll });
    expect(m.status).toBe(201);
    const reporters = [newCaller(), newCaller(), newCaller()];
    expect((await live.post("/live-api/report", { messageId: m.json.id }, { ip: reporters[0] })).json).toEqual({ ok: true, hidden: false });
    expect((await live.post("/live-api/report", { messageId: m.json.id }, { ip: reporters[1] })).json).toEqual({ ok: true, hidden: false });
    const third = await live.post("/live-api/report", { messageId: m.json.id }, { ip: reporters[2] });
    expect(third.json).toEqual({ ok: true, hidden: true });

    const hide = await s.next("hide", (d) => d.ids.includes(m.json.id));
    expect(hide.data.ids).toEqual([m.json.id]);
    const { rows } = await live.pool.query(`SELECT hidden_by FROM live_messages WHERE id = $1`, [m.json.id]);
    expect(rows[0].hidden_by).toBe("reports");

    const muted = await live.post("/live-api/messages", { body: unique() }, { ip: troll });
    expect(muted.status).toBe(403);
    expect(muted.json).toMatchObject({ error: "muted", reason: "reports" });
    expect(muted.json.retryAfter).toBeGreaterThan(REPORT_MUTE_MS / 1000 - 30);
    expect(muted.json.retryAfter).toBeLessThanOrEqual(REPORT_MUTE_MS / 1000);

    // A later stream does not replay it, and does tell a reconnecting client to drop it.
    const late = await live.stream({ ip: newCaller() });
    const hello = await late.next("hello");
    expect(hello.data.recent.map((x) => x.id)).not.toContain(m.json.id);
    expect(hello.data.hidden).toContain(m.json.id);
    s.close();
    late.close();

    // The mute ends by itself.
    await live.pool.query(
      `UPDATE live_mutes SET until = now() - interval '1 second' WHERE client_ref = (SELECT client_ref FROM live_messages WHERE id = $1)`,
      [m.json.id],
    );
    tick();
    expect((await live.post("/live-api/messages", { body: unique() }, { ip: troll })).status).toBe(201);
  });

  it("three reports from ONE caller do nothing", async () => {
    const author = newCaller();
    const m = await live.post("/live-api/messages", { body: unique("not a troll") }, { ip: author });
    const snitch = newCaller();
    for (let i = 0; i < 3; i++) {
      expect((await live.post("/live-api/report", { messageId: m.json.id }, { ip: snitch })).json.hidden).toBe(false);
    }
    const { rows } = await live.pool.query(`SELECT hidden_at FROM live_messages WHERE id = $1`, [m.json.id]);
    expect(rows[0].hidden_at).toBeNull();
    tick();
    expect((await live.post("/live-api/messages", { body: unique() }, { ip: author })).status).toBe(201);
  });

  it("the same household on IPv6 is one reporter, however many addresses and browsers it uses", async () => {
    const m = await live.post("/live-api/messages", { body: unique("ipv6") }, { ip: newCaller() });
    const prefix = `2001:db8:${randomBytes(2).toString("hex")}:1`;
    // Three browsers (a jar each) on three addresses in one /64: three reports
    // would hide the message if each counted.
    for (const suffix of ["::1", "::2", ":aaaa::3"]) {
      const r = await live.post("/live-api/report", { messageId: m.json.id }, { ip: `${prefix}${suffix}` });
      expect(r.json.hidden).toBe(false);
    }
    const { rows } = await live.pool.query(
      `SELECT count(DISTINCT COALESCE(addr_ref, client_ref))::int AS n FROM live_reports WHERE message_id = $1`,
      [m.json.id],
    );
    expect(rows[0].n).toBe(1);
    const { rows: msg } = await live.pool.query(`SELECT hidden_at FROM live_messages WHERE id = $1`, [m.json.id]);
    expect(msg[0].hidden_at).toBeNull();
  });

  it("your own message: reporting it is accepted and does nothing", async () => {
    const me = newCaller();
    const m = await live.post("/live-api/messages", { body: unique("mine") }, { ip: me });
    expect((await live.post("/live-api/report", { messageId: m.json.id }, { ip: me })).json).toEqual({ ok: true, hidden: false });
    const { rows } = await live.pool.query(`SELECT count(*)::int AS n FROM live_reports WHERE message_id = $1`, [m.json.id]);
    expect(rows[0].n).toBe(0);
  });

  it("a report of nothing is 404", async () => {
    expect((await live.post("/live-api/report", { messageId: 9e15 }, { ip: newCaller() })).status).toBe(404);
    expect((await live.post("/live-api/report", { messageId: "1" }, { ip: newCaller() })).status).toBe(404);
  });
});

describeDb("admin", () => {
  let live;
  beforeAll(async () => {
    live = await startLive({ now: () => clock });
  });
  afterAll(async () => {
    await live?.close();
  });

  it("every admin action is 401 without the credential — the client-side admin hash is irrelevant", async () => {
    const m = await live.post("/live-api/messages", { body: unique() }, { ip: newCaller() });
    const ip = newCaller();
    for (const action of ["hide", "mute", "ban", "slow", "clear-name"]) {
      const r = await live.post(`/live-api/admin/${action}`, { messageId: m.json.id }, {
        ip,
        // What the app's client-side admin mode has: a localStorage flag, and
        // whatever a script could put in a cookie. None of it is a credential.
        headers: { cookie: "hd-admin=true; isAdmin=1", "x-hd-admin": "1" },
      });
      expect(r.status, action).toBe(401);
    }
    const forged = await live.post("/live-api/admin/hide", { messageId: m.json.id }, {
      ip,
      headers: { cookie: `${ADMIN_COOKIE}=${sessionValue("not-the-token")}` },
    });
    expect(forged.status).toBe(401);
    const wrongBearer = await live.post("/live-api/admin/hide", { messageId: m.json.id }, { ip, headers: { authorization: "Bearer nope" } });
    expect(wrongBearer.status).toBe(401);
    const { rows } = await live.pool.query(`SELECT hidden_at FROM live_messages WHERE id = $1`, [m.json.id]);
    expect(rows[0].hidden_at).toBeNull();
    expect((await live.get("/live-api/me", { ip })).json.admin).toBe(false);
  });

  it("the one-time link: works once, sets an HttpOnly Secure SameSite=Strict session, then never again", async () => {
    const nonce = randomBytes(32).toString("hex");
    await live.app.store.addNonce(sha256hex(nonce), Date.now() + 60_000);
    const ip = newCaller();
    const r = await live.post("/live-api/admin/signin", { nonce }, { ip });
    expect(r.status).toBe(200);
    const cookie = r.headers.get("set-cookie");
    expect(cookie).toMatch(new RegExp(`^${ADMIN_COOKIE}=v1\\.\\d+\\.[0-9a-f]{64};`));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/live-api/);
    // The long-lived token is not in it.
    expect(cookie).not.toContain(live.adminToken);
    // Only the hash was ever stored.
    const { rows } = await live.pool.query(`SELECT hash FROM live_admin_nonces WHERE hash = $1`, [sha256hex(nonce)]);
    expect(rows).toHaveLength(1);
    expect((await live.pool.query(`SELECT 1 FROM live_admin_nonces WHERE hash = $1`, [nonce])).rows).toHaveLength(0);

    const session = cookie.split(";")[0];
    expect((await live.get("/live-api/me", { ip, headers: { cookie: session } })).json.admin).toBe(true);
    const m = await live.post("/live-api/messages", { body: unique("to hide") }, { ip: newCaller() });
    expect((await live.post("/live-api/admin/hide", { messageId: m.json.id }, { ip, headers: { cookie: session } })).status).toBe(200);

    // Single use.
    expect((await live.post("/live-api/admin/signin", { nonce }, { ip: newCaller() })).status).toBe(401);
  });

  it("the one-time link expires", async () => {
    const nonce = randomBytes(32).toString("hex");
    await live.app.store.addNonce(sha256hex(nonce), Date.now() - 1_000);
    expect((await live.post("/live-api/admin/signin", { nonce }, { ip: newCaller() })).status).toBe(401);
  });

  it("sign-in is refused cross-origin, and rate limited", async () => {
    const nonce = randomBytes(32).toString("hex");
    await live.app.store.addNonce(sha256hex(nonce), Date.now() + 60_000);
    expect((await live.post("/live-api/admin/signin", { nonce }, { ip: newCaller(), origin: "https://evil.example" })).status).toBe(403);
    const ip = newCaller();
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await live.post("/live-api/admin/signin", { nonce: "0".repeat(64) }, { ip })).status);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });

  it("session cookies expire and are bound to the token", () => {
    const v = sessionValue("tok", 1_000);
    expect(verifySession(v, "tok", 2_000)).toBe(true);
    expect(verifySession(v, "other", 2_000)).toBe(false);
    expect(verifySession(v, "tok", 1_000 + 31 * 24 * 3600_000)).toBe(false);
    expect(verifySession(v.replace(/.$/, (c) => (c === "0" ? "1" : "0")), "tok", 2_000)).toBe(false);
  });

  it("the sign-in page carries a strict CSP and removes the nonce from the address bar before using it", async () => {
    const r = await live.get("/live-api/admin/signin-page");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toMatch(/default-src 'none'; script-src 'sha256-/);
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.text.indexOf("history.replaceState")).toBeLessThan(r.text.indexOf("fetch("));
  });

  it("verify: the deploy's round trip writes, reads back and deletes a hidden row, and needs the credential", async () => {
    const s = await live.stream({ ip: newCaller() });
    await s.next("hello");
    expect((await live.post("/live-api/admin/verify", {}, { ip: newCaller() })).status).toBe(401);
    const r = await live.admin("verify", {});
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    const { rows } = await live.pool.query(`SELECT 1 FROM live_messages WHERE id = $1`, [r.json.id]);
    expect(rows).toHaveLength(0);
    await new Promise((res) => setTimeout(res, 50));
    expect(s.events.filter((e) => e.event === "message")).toEqual([]);
    s.close();
  });

  describe("with the credential", () => {
    it("mute: the sender is held, the message hidden", async () => {
      const troll = newCaller();
      const m = await live.post("/live-api/messages", { body: unique() }, { ip: troll });
      expect((await live.admin("mute", { messageId: m.json.id, minutes: 5 }, { ip: newCaller() })).json).toEqual({ ok: true, minutes: 5 });
      const r = await live.post("/live-api/messages", { body: unique() }, { ip: troll });
      expect(r.status).toBe(403);
      expect(r.json.reason).toBe("admin");
    });

    it("ban: the sender cannot post, cannot open a stream, is disconnected, and their recent messages go", async () => {
      const troll = newCaller();
      const own = await live.stream({ ip: troll });
      await own.next("hello");
      const watcher = await live.stream({ ip: newCaller() });
      await watcher.next("hello");
      const a = await live.post("/live-api/messages", { body: unique("spam one") }, { ip: troll });
      tick();
      const b = await live.post("/live-api/messages", { body: unique("spam two") }, { ip: troll });
      expect(b.status).toBe(201);
      const r = await live.admin("ban", { messageId: b.json.id }, { ip: newCaller() });
      expect(r.json).toEqual({ ok: true, hidden: 2 });
      const hide = await watcher.next("hide", (d) => d.ids.includes(a.json.id));
      expect(hide.data.ids.sort()).toEqual([a.json.id, b.json.id].sort());

      await new Promise((res) => setTimeout(res, 100));
      expect(own.ended).toBe(true);
      const post = await live.post("/live-api/messages", { body: unique() }, { ip: troll });
      expect(post.status).toBe(403);
      expect(post.json.error).toBe("banned");
      const again = await live.stream({ ip: troll });
      expect(again.status).toBe(403);
      expect((await live.get("/live-api/me", { ip: troll })).json.banned).toBe(true);
      watcher.close();
    });

    it("slow: forced on and off, announced", async () => {
      const s = await live.stream({ ip: newCaller() });
      await s.next("hello");
      const on = await live.admin("slow", { on: true, minutes: 5 });
      expect(on.json.slowMode).toMatchObject({ on: true, forced: true });
      expect((await s.next("slow", (d) => d.forced)).data.on).toBe(true);
      const off = await live.admin("slow", { on: false });
      expect(off.json.slowMode.forced).toBe(false);
      expect((await s.next("slow", (d) => !d.forced)).data.forced).toBe(false);
      s.close();
    });

    it("clear-name: the caller gets a fresh name, on their past messages too", async () => {
      const who = newCaller();
      // token(), never hex: 1 in ~650 hex suffixes reads as leetspeak ("455…") and the filter refuses it.
      const named = await live.post("/live-api/name", { name: `Bad Name ${token(6)}` }, { ip: who });
      expect(named.status).toBe(200);
      const m = await live.post("/live-api/messages", { body: unique() }, { ip: who });
      expect(m.json.name).toBe(named.json.name);
      const s = await live.stream({ ip: newCaller() });
      await s.next("hello");
      const r = await live.admin("clear-name", { messageId: m.json.id });
      expect(r.status).toBe(200);
      expect(r.json.name).not.toBe(named.json.name);
      const ev = await s.next("rename", (d) => d.ids.includes(m.json.id));
      expect(ev.data.name).toBe(r.json.name);
      expect((await live.get("/live-api/me", { ip: who })).json.name).toBe(r.json.name);
      // ...and they cannot put the bad one straight back.
      expect((await live.post("/live-api/name", { name: named.json.name }, { ip: who })).status).toBe(429);
      s.close();
    });
  });
});
