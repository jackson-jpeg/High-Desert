// @vitest-environment node
import { it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { describeDb } from "../../../src/test-support/test-db.ts";
import { startLive, newCaller, unique } from "./helpers.mjs";
import { STATION_KEEP_MS, STATION_ON_HELLO } from "../lib/app.mjs";

/**
 * Station notices survive a restart (2026-10-29). They were memory only, and
 * the chat deploy of that day wiped every "From the station" line. Each test
 * posts through one app, closes it, and starts a second on the same database
 * and scope: the restart a deploy does. What survives is read the way a
 * listener gets it (hello) and the way the console does (overview).
 */

let clock = Date.now();
const opened = [];
afterEach(async () => {
  while (opened.length) await opened.pop().close();
});

/** One "service": its own scope (settingsKey) and admin token, restartable. */
function service() {
  const settingsKey = `test-${randomBytes(6).toString("hex")}`;
  const adminToken = randomBytes(32).toString("hex");
  const start = async () => {
    const live = await startLive({ settingsKey, adminToken, now: () => clock });
    opened.push(live);
    return live;
  };
  start.scope = settingsKey;
  return start;
}
const notice = (live, text) => live.admin("notice", { text });
async function hello(live) {
  const s = await live.stream({ ip: newCaller() });
  const h = await s.next("hello");
  s.close();
  return h.data;
}
async function overviewNotices(live) {
  const r = await live.get("/live-api/admin/overview?limit=1", { jar: false, headers: { authorization: `Bearer ${live.adminToken}` } });
  expect(r.status).toBe(200);
  return r.json.notices;
}

describeDb("station notices", () => {
  it("are still there after a restart, with their original id and time", async () => {
    const start = service();
    const first = await start();
    const posted = await notice(first, unique("The phone lines are back."));
    expect(posted.status).toBe(201);
    const { id, at, text } = posted.json;
    await opened.pop().close();

    clock += 60_000; // the restart takes a minute: "at" must still be the post's, not the start's
    const second = await start();
    expect((await hello(second)).station).toEqual([expect.objectContaining({ id, at, text, reason: "station" })]);
    expect(await overviewNotices(second)).toEqual([expect.objectContaining({ id, at, text })]);
  });

  it("belong to their own service: another scope on the same database sees none of them (control)", async () => {
    const mine = await service()();
    expect((await notice(mine, unique("only here"))).status).toBe(201);
    const other = await service()();
    expect((await hello(other)).station).toEqual([]);
  });

  it("keep the old rules across a restart: 12 hours, the newest three", async () => {
    const start = service();
    const first = await start();
    const old = await notice(first, unique("old"));
    clock += STATION_KEEP_MS - 30 * 60_000;
    const kept = [];
    for (let i = 0; i < STATION_ON_HELLO + 1; i++) {
      clock += 1_000;
      kept.push((await notice(first, unique(`n${i}`))).json);
    }
    await opened.pop().close();

    clock += 60 * 60_000; // past 12 hours for the first one, not for the rest
    const second = await start();
    const station = (await hello(second)).station;
    expect(station.map((l) => l.id)).toEqual(kept.slice(-STATION_ON_HELLO).map((l) => l.id));
    expect(station.map((l) => l.id)).not.toContain(old.json.id);
    // And the table itself holds no more than that: what aged out was deleted, not just hidden.
    const { rows } = await second.pool.query(`SELECT id FROM live_station_notices WHERE scope = $1 ORDER BY at`, [start.scope]);
    expect(rows.map((r) => r.id)).toEqual(kept.slice(-STATION_ON_HELLO).map((l) => l.id));
  });
});
