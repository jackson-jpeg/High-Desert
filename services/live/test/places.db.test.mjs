/**
 * "Calling from" and tune-in notices (2026-09-27, docs/live-chat.md).
 *
 * Launch night's callers greeted the room from Belgium, Canada and Denver
 * under generated desert-town names. A caller can now say where they are:
 * optional, filtered like a name, limited like one, cleared at any time, and
 * carried on each call as it was when sent. The room also hears, as one quiet
 * batched line, when listeners tune in, with their place if they gave one.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startLive, newCaller, unique, TEST_DATABASE_URL } from "./helpers.mjs";
import { MAX_PLACE_CHARS } from "../lib/config.mjs";

const d = TEST_DATABASE_URL ? describe : describe.skip;

let clock = Date.now();
const tick = (ms = 5_000) => {
  clock += ms;
};
/** A name the filter refuses, not written here in plain text (the fixtures' rule). */
const REFUSED = Buffer.from("bmlnZ2VyIGluIEJhcnN0b3c=", "base64").toString("utf8");

d("calling from", () => {
  let live;
  beforeAll(async () => {
    live = await startLive({ now: () => clock });
  });
  afterAll(async () => {
    await live?.close();
  });

  const place = (ip, value) => live.post("/live-api/place", { place: value }, { ip });
  const call = (ip, body = unique()) => {
    tick();
    return live.post("/live-api/messages", { body }, { ip });
  };
  const me = (ip) => live.get("/live-api/me", { ip });

  it("a first caller has no place and is told it is a first call; the place set is on their next call, on /me and in hello", async () => {
    const ip = newCaller();
    const before = await me(ip);
    expect(before.json).toMatchObject({ place: null, firstCall: true });

    const r = await place(ip, "  Ghent ");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ place: "Ghent", nextChangeInS: 600 });
    // Setting a place is not a call.
    expect((await me(ip)).json).toMatchObject({ place: "Ghent", firstCall: true, nextPlaceChangeInS: expect.any(Number) });

    const m = await call(ip);
    expect(m.status).toBe(201);
    expect(m.json.place).toBe("Ghent");
    expect((await me(ip)).json.firstCall).toBe(false);

    const s = await live.stream({ ip });
    const hello = await s.next("hello");
    expect(hello.data.you).toMatchObject({ place: "Ghent", firstCall: false });
    expect(hello.data.recent.find((x) => x.id === m.json.id)?.place).toBe("Ghent");
    s.close();
  });

  it("is filtered like a name: too long, odd characters, contact details and slurs are refused, and nothing is stored", async () => {
    const ip = newCaller();
    const cases = [
      ["x".repeat(MAX_PLACE_CHARS + 1), "place-too-long"],
      ["G", "place-too-short"],
      ["<Ghent>", "place-chars"],
      ["Art Bell's studio", "place-reserved"],
      ["call 555 867 5309", "phone"],
      [REFUSED, "place-profane"],
    ];
    for (const [value, reason] of cases) {
      const r = await place(ip, value);
      expect(r.status, value).toBe(400);
      expect(r.json).toMatchObject({ error: "rejected", reason });
      expect(r.json.message).toBeTruthy();
      expect(r.json.message).not.toMatch(/—/);
    }
    expect((await me(ip)).json.place).toBeNull();
  });

  it("changes are limited like names; clearing is always allowed and does not reset the limit", async () => {
    const ip = newCaller();
    expect((await place(ip, "Denver")).status).toBe(200);
    const again = await place(ip, "Boulder");
    expect(again.status).toBe(429);
    expect(again.json).toMatchObject({ error: "rate", retryAfter: expect.any(Number) });
    expect(again.json.retryAfter).toBeGreaterThan(500);
    // The same place again is not a change.
    expect((await place(ip, "Denver")).status).toBe(200);

    const cleared = await place(ip, "");
    expect(cleared.status).toBe(200);
    expect(cleared.json.place).toBeNull();
    expect((await call(ip)).json.place).toBeNull();
    // Clearing was not a way round the limit.
    expect((await place(ip, "Boulder")).status).toBe(429);
  });

  it("a call keeps the place it was sent with", async () => {
    const ip = newCaller();
    await place(ip, "Toronto");
    const first = await call(ip);
    await place(ip, null);
    const second = await call(ip);
    expect([first.json.place, second.json.place]).toEqual(["Toronto", null]);
    const s = await live.stream({ ip });
    const hello = await s.next("hello");
    const byId = new Map(hello.data.recent.map((x) => [x.id, x.place]));
    expect([byId.get(first.json.id), byId.get(second.json.id)]).toEqual(["Toronto", null]);
    s.close();
  });

  it("an admin clearing a name clears the place too, on the caller and on what they said", async () => {
    const ip = newCaller();
    await place(ip, "Pahrump");
    const m = await call(ip);
    const watcher = await live.stream({ ip: newCaller() });
    await watcher.next("hello");
    const r = await live.admin("clear-name", { messageId: m.json.id }, { ip: newCaller() });
    expect(r.status).toBe(200);
    const ev = await watcher.next("rename", (x) => x.ids.includes(m.json.id));
    expect(ev.data.place).toBeNull();
    expect((await me(ip)).json.place).toBeNull();
    watcher.close();
  });
});

d("tune-in notices", () => {
  let live;
  beforeAll(async () => {
    live = await startLive({ now: () => clock, tuneinBatchMs: 400 });
  });
  afterAll(async () => {
    await live?.close();
  });

  const tuned = (ip) => live.post("/live-api/tuned", {}, { ip });

  it("the first tune-in is a line at once, with the caller's place; the next ones wait and go out as one line", async () => {
    const room = await live.stream({ ip: newCaller() });
    await room.next("hello");

    const ohio = newCaller();
    await live.post("/live-api/place", { place: "Ohio" }, { ip: ohio });
    expect((await tuned(ohio)).json).toEqual({ announced: true });
    const first = await room.next("tunein", () => true, 1_000);
    expect(first.data).toMatchObject({ count: 1, places: ["Ohio"] });

    // Three more inside the window: one line, not three.
    const quiet = [newCaller(), newCaller(), newCaller()];
    await live.post("/live-api/place", { place: "Ghent" }, { ip: quiet[0] });
    for (const ip of quiet) expect((await tuned(ip)).json.announced).toBe(true);
    const batch = await room.next("tunein", () => true, 2_000);
    expect(batch.data).toMatchObject({ count: 3, places: ["Ghent"] });
    expect(batch.at - first.at).toBeGreaterThanOrEqual(300);
    await new Promise((r) => setTimeout(r, 600));
    expect(room.events.filter((e) => e.event === "tunein")).toHaveLength(2);

    // A new stream's hello carries the last notices.
    const late = await live.stream({ ip: newCaller() });
    const hello = await late.next("hello");
    expect(hello.data.tuneins.map((n) => n.count).slice(-2)).toEqual([1, 3]);
    room.close();
    late.close();
  });

  it("the same caller tuning in again within the hour is not announced again", async () => {
    const ip = newCaller();
    expect((await tuned(ip)).json.announced).toBe(true);
    expect((await tuned(ip)).json.announced).toBe(false);
    tick(61 * 60_000);
    expect((await tuned(ip)).json.announced).toBe(true);
  });

  it("is a POST from our own origin, as JSON, like every other write", async () => {
    const ip = newCaller();
    expect((await live.post("/live-api/tuned", {}, { ip, origin: "https://evil.example" })).status).toBe(403);
    expect((await live.post("/live-api/tuned", "{}", { ip, type: "text/plain" })).status).toBe(415);
  });
});
