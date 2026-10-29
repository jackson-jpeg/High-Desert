// @vitest-environment node
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeDb } from "../../../src/test-support/test-db.ts";
import { startLive, newCaller, unique } from "./helpers.mjs";

/**
 * The admin console (sang3r.com, 2026-10-29): GET /live-api/admin/overview,
 * and the undo actions unhide, unmute and unban. Everything is asserted on
 * what a listener then sees or can do, not only on rows.
 */

// The service's clock: one message per caller every few seconds, so each
// post moves it on.
let clock = Date.now();

describeDb("the admin console", () => {
  let live;
  beforeAll(async () => {
    live = await startLive({ now: () => clock });
  });
  afterAll(async () => {
    await live?.close();
  });

  const bearer = () => ({ headers: { authorization: `Bearer ${live.adminToken}` } });
  const overview = (query = "") => live.get(`/live-api/admin/overview${query}`, { jar: false, ...bearer() });
  const say = (ip, label) => {
    clock += 5_000;
    return live.post("/live-api/messages", { body: unique(label) }, { ip });
  };
  const hello = async () => {
    const s = await live.stream({ ip: newCaller() });
    const h = await s.next("hello");
    s.close();
    return h.data;
  };

  it("refuses anyone without the admin credential", async () => {
    expect((await live.get("/live-api/admin/overview", { jar: false })).status).toBe(401);
    expect((await live.get("/live-api/admin/overview", { jar: false, headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await live.get("/live-api/admin/overview", { headers: { cookie: "hd-admin=true" } })).status).toBe(401);
  });

  it("lists hidden messages too, with reports, the caller's ref and standing; the public never sees the ref", async () => {
    const author = newCaller();
    const shown = await say(author, "stays up");
    const gone = await say(author, "gets hidden");
    expect((await live.admin("hide", { messageId: gone.json.id })).status).toBe(200);
    await live.post("/live-api/report", { messageId: shown.json.id }, { ip: newCaller() });

    const r = await overview();
    expect(r.status).toBe(200);
    const byId = new Map(r.json.messages.map((m) => [m.id, m]));
    expect(byId.get(gone.json.id)).toMatchObject({ body: gone.json.body, hiddenBy: "admin", banned: false, mutedUntil: null });
    expect(byId.get(gone.json.id).hiddenAt).toEqual(expect.any(String));
    expect(byId.get(shown.json.id)).toMatchObject({ hiddenAt: null, hiddenBy: null, reports: 1 });
    // One caller, one ref, and it is an HMAC (64 hex), never an address.
    expect(byId.get(shown.json.id).callerRef).toMatch(/^[0-9a-f]{64}$/);
    expect(byId.get(shown.json.id).callerRef).toBe(byId.get(gone.json.id).callerRef);
    // Newest first.
    expect(r.json.messages[0].id).toBeGreaterThan(r.json.messages[1].id);
    expect(r.json).toMatchObject({ slowMode: { on: false }, mutes: expect.any(Array), bans: expect.any(Array), notices: expect.any(Array) });
    expect(r.json.health).toMatchObject({ clients: expect.any(Number), messagesLastHour: expect.any(Number) });

    // The public hello carries neither the hidden message nor any ref.
    const h = await hello();
    expect(h.recent.map((m) => m.id)).not.toContain(gone.json.id);
    expect(JSON.stringify(h)).not.toContain(byId.get(shown.json.id).callerRef);
  });

  it("pages with limit and before", async () => {
    const ip = newCaller();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await say(ip, `page ${i}`)).json.id);
    const top = await overview("?limit=2");
    expect(top.json.messages.map((m) => m.id)).toEqual([ids[2], ids[1]]);
    const next = await overview(`?limit=1&before=${ids[1]}`);
    expect(next.json.messages.map((m) => m.id)).toEqual([ids[0]]);
    // A malformed limit falls back to the default rather than failing.
    expect((await overview("?limit=lots")).status).toBe(200);
  });

  it("unhide puts a hidden message back in every hello from then on", async () => {
    const m = await say(newCaller(), "hidden by mistake");
    await live.admin("hide", { messageId: m.json.id });
    expect((await hello()).recent.map((x) => x.id)).not.toContain(m.json.id);
    const r = await live.admin("unhide", { messageId: m.json.id });
    expect(r.json).toEqual({ ok: true, shown: true });
    expect((await hello()).recent.map((x) => x.id)).toContain(m.json.id);
    // Again: it was not hidden, so nothing changed.
    expect((await live.admin("unhide", { messageId: m.json.id })).json).toEqual({ ok: true, shown: false });
    expect((await live.admin("unhide", { messageId: 999_999_999 })).status).toBe(404);
  });

  it("unmute lets a muted caller talk again, by the ref from the console's mute list", async () => {
    const ip = newCaller();
    const m = await say(ip, "too loud");
    expect((await live.admin("mute", { messageId: m.json.id, minutes: 60 })).status).toBe(200);
    expect((await say(ip, "still here")).status).toBe(403);
    const ref = await refOf(m.json.id);
    const mine = (await overview()).json.mutes.find((x) => x.callerRef === ref);
    expect(mine).toMatchObject({ reason: "admin", until: expect.any(String) });
    const r = await live.admin("unmute", { callerRef: mine.callerRef });
    expect(r.json).toEqual({ ok: true, lifted: true });
    expect((await say(ip, "back on the air")).status).toBe(201);
    expect((await overview()).json.mutes.map((x) => x.callerRef)).not.toContain(mine.callerRef);
    expect((await live.admin("unmute", { callerRef: mine.callerRef })).json).toEqual({ ok: true, lifted: false });
  });

  it("unban reconnects a banned caller and lifts the hold on their address", async () => {
    const ip = newCaller();
    const m = await say(ip, "banned for this");
    expect((await live.admin("ban", { messageId: m.json.id })).status).toBe(200);
    expect((await say(ip, "let me back")).status).toBe(403);
    const ref = await refOf(m.json.id);
    expect((await overview()).json.bans.map((b) => b.callerRef)).toContain(ref);
    const holds = async () =>
      (await live.pool.query(`SELECT count(*)::int AS n FROM live_address_holds WHERE addr_ref = (SELECT addr_ref FROM live_messages WHERE id = $1)`, [m.json.id])).rows[0].n;
    expect(await holds()).toBe(1);

    const r = await live.admin("unban", { messageId: m.json.id });
    expect(r.json).toEqual({ ok: true, lifted: true });
    expect(await holds()).toBe(0);
    expect((await say(ip, "thanks for having me back")).status).toBe(201);
    expect((await overview()).json.bans.map((b) => b.callerRef)).not.toContain(ref);
    // What the ban hid stays hidden: unhide is its own choice.
    expect((await hello()).recent.map((x) => x.id)).not.toContain(m.json.id);
  });

  it("an undo needs a caller: a malformed ref is refused, and an unknown message is a 404", async () => {
    expect((await live.admin("unmute", { callerRef: "not-a-ref" })).status).toBe(400);
    expect((await live.admin("unban", {})).status).toBe(400);
    expect((await live.admin("unban", { messageId: 999_999_999 })).status).toBe(404);
  });

  async function refOf(messageId) {
    const { rows } = await live.pool.query(`SELECT client_ref FROM live_messages WHERE id = $1`, [messageId]);
    return rows[0].client_ref;
  }
});
