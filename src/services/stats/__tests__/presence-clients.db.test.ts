// @vitest-environment node
import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";

/**
 * "Online" is people, not page loads.
 *
 * A session id is minted per page load, and getPresence counted sessions: two
 * tabs were two people, and a tab closed without its unload beacon (routine on
 * mobile Safari) was a second person for up to five minutes. Online is now the
 * distinct clients with a heartbeat inside the window, and listening is the
 * subset of those clients with a session that is playing.
 *
 * Against real Postgres, through the real recordHeartbeat/recordPlay writes,
 * because the property is the SQL's. Scoped to this file's session ids with
 * getPresence's test-only prefix, so a parallel DB test cannot move the count.
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

const TAG = `clientsdb${process.pid}`;
let seq = 0;
const sid = (label: string) => `${TAG}-${label}-${++seq}`;
const presence = () => store.getPresence(`${TAG}-`);

afterEach(async () => {
  await store.getPool().query("DELETE FROM active_sessions WHERE starts_with(session_id, $1)", [`${TAG}-`]);
});

describeDb("presence counts clients (Postgres)", () => {
  it("three tabs from one household are one person online", async () => {
    for (let i = 0; i < 3; i++) await store.recordHeartbeat(sid("home"), null, "198.51.100.20");
    expect(await presence()).toEqual({ online: 1, listening: 0 });

    await store.recordHeartbeat(sid("other"), null, "203.0.113.20");
    expect(await presence()).toEqual({ online: 2, listening: 0 });
  });

  it("listening is the clients with a playing session, and never exceeds online", async () => {
    // Household A: three tabs, one playing.
    await store.recordHeartbeat(sid("a"), null, "198.51.100.30");
    await store.recordHeartbeat(sid("a"), null, "198.51.100.30");
    await store.recordHeartbeat(sid("a"), "coll--a-show", "198.51.100.30");
    // Household B: two tabs, both playing the same show.
    await store.recordHeartbeat(sid("b"), "coll--b-show", "203.0.113.30");
    await store.recordHeartbeat(sid("b"), "coll--b-show", "203.0.113.30");
    // Household C: open, not playing.
    await store.recordHeartbeat(sid("c"), null, "192.0.2.30");

    const p = await presence();
    expect(p).toEqual({ online: 3, listening: 2 });
    expect(p.listening).toBeLessThanOrEqual(p.online);
  });

  it("a stopped session stops counting as listening but stays online", async () => {
    const s = sid("stop");
    await store.recordHeartbeat(s, "coll--c-show", "192.0.2.40");
    expect(await presence()).toEqual({ online: 1, listening: 1 });
    await store.clearListening(s);
    expect(await presence()).toEqual({ online: 1, listening: 0 });
  });
});
