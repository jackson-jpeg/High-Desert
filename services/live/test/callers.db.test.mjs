/**
 * One browser, one caller (2026-09-26). The phone lines used to key every
 * caller on an HMAC of the client address, so a household shared one name, one
 * line and one rename limit, and strangers behind a mobile carrier's NAT shared
 * all of that and each other's mutes and bans. A caller is now the signed
 * random id in the hd_live_caller cookie; the address is a secondary, generous
 * abuse limit (services/live/lib/caller.mjs, docs/live-chat.md).
 *
 * "Behind the same address" here is the same X-Forwarded-For, as nginx sends
 * it, with a separate cookie jar per browser (helpers.mjs).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startLive, newCaller, unique, token, TEST_DATABASE_URL } from "./helpers.mjs";
import { addressRef, callerCookieValue, mintCallerId } from "../lib/caller.mjs";
import { LINES, lineFor } from "../lib/names.mjs";
import { FIRST_CALLS_PER_ADDRESS_HOUR, NEW_CALLERS_PER_ADDRESS_HOUR } from "../lib/config.mjs";

const d = TEST_DATABASE_URL ? describe : describe.skip;

// The service's clock, so a test can step past the 3 s per-caller pace.
let clock = Date.now();
const tick = (ms = 5_000) => {
  clock += ms;
};

d("callers are browsers, not addresses", () => {
  let live;
  const secret = "c".repeat(64);
  beforeAll(async () => {
    live = await startLive({ clientSecret: secret, now: () => clock });
  });
  afterAll(async () => {
    await live?.close();
  });

  const me = (ip, caller) => live.get("/live-api/me", { ip, caller });
  /** A call, a pace-length after the last one. */
  const call = (ip, caller, body = unique()) => {
    tick();
    return live.post("/live-api/messages", { body }, { ip, caller });
  };
  const rename = (ip, caller, name) => live.post("/live-api/name", { name }, { ip, caller });

  it("two browsers behind one address are two callers, with their own names and lines, and each renames on its own", async () => {
    const ip = newCaller();
    const a = await me(ip, "a");
    const b = await me(ip, "b");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // A cookie each, and they differ.
    expect(live.cookieOf("a")).toMatch(/^v1\./);
    expect(live.cookieOf("b")).toMatch(/^v1\./);
    expect(live.cookieOf("a")).not.toBe(live.cookieOf("b"));
    expect(a.json.name).not.toBe(b.json.name);
    expect(a.json.line).not.toBe(b.json.line);

    // Each renames, one after the other, inside the ten-minute limit.
    const nameA = `Caller ${token(6)}`;
    const nameB = `Caller ${token(6)}`;
    expect((await rename(ip, "a", nameA)).status).toBe(200);
    expect((await rename(ip, "b", nameB)).status).toBe(200);
    // ...and each keeps their own, on the next call and on /me.
    expect((await call(ip, "a")).json.name).toBe(nameA);
    expect((await call(ip, "b")).json.name).toBe(nameB);
    expect((await me(ip, "a")).json.name).toBe(nameA);
    expect((await me(ip, "b")).json.name).toBe(nameB);
    // The limit is per browser: a's second rename waits, b's first did not.
    expect((await rename(ip, "a", `Caller ${token(6)}`)).status).toBe(429);
  });

  it("browsers behind one address never share a line while lines are free, even when their refs would", async () => {
    const ip = newCaller();
    const lines = [];
    const preferred = [];
    // Until two of them would land on the same line by their ref alone.
    for (let i = 0; i < LINES.length; i++) {
      const r = await me(ip, `line-${ip}-${i}`);
      lines.push(r.json.line);
      preferred.push(lineFor(live.app.refForCookie(live.cookieOf(`line-${ip}-${i}`))));
      if (new Set(preferred).size < preferred.length) break;
    }
    expect(new Set(preferred).size).toBeLessThan(preferred.length); // the collision this test is about
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("the cookie is the identity: kept, a browser is the same caller; cleared, it is a new one", async () => {
    const ip = newCaller();
    const first = await me(ip, "keeper");
    expect((await me(ip, "keeper")).json.name).toBe(first.json.name);
    live.clearCookies("keeper");
    const again = await me(ip, "keeper");
    expect(again.json.name).not.toBe(first.json.name);
  });

  it("a cookie the service did not sign is ignored: the browser is given a real one", async () => {
    const ip = newCaller();
    const forged = `v1.${mintCallerId()}.${"A".repeat(43)}`;
    const r = await live.get("/live-api/me", { ip, jar: false, headers: { cookie: `hd_live_caller=${forged}` } });
    expect(r.status).toBe(200);
    const set = r.headers.getSetCookie().find((c) => c.startsWith("hd_live_caller="));
    expect(set).toBeDefined();
    expect(set).not.toContain(forged);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/Secure/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Path=\/live-api/);
    expect(set).toMatch(/Max-Age=34560000/);
    // One the service did sign is accepted as is.
    const signed = callerCookieValue(secret, mintCallerId());
    const ok = await live.get("/live-api/me", { ip, jar: false, headers: { cookie: `hd_live_caller=${signed}` } });
    expect(ok.headers.getSetCookie().some((c) => c.startsWith("hd_live_caller="))).toBe(false);
  });

  it("muting one browser does not mute the other behind the same address", async () => {
    const ip = newCaller();
    const a = await call(ip, "mute-a");
    expect((await call(ip, "mute-b")).status).toBe(201);
    expect((await live.admin("mute", { messageId: a.json.id, minutes: 5 })).status).toBe(200);
    const muted = await call(ip, "mute-a");
    expect(muted.status).toBe(403);
    expect(muted.json.error).toBe("muted");
    expect((await call(ip, "mute-b")).status).toBe(201);
  });

  it("three reports from one person with three cookies do not hide a call or mute anyone", async () => {
    const author = newCaller();
    const m = await call(author, "reported");
    const snitch = newCaller();
    for (const c of ["s1", "s2", "s3"]) {
      const r = await live.post("/live-api/report", { messageId: m.json.id }, { ip: snitch, caller: c });
      expect(r.json.hidden).toBe(false);
    }
    expect((await call(author, "reported")).status).toBe(201);
  });

  it("three reports from three places mute the author only, not their household", async () => {
    const ip = newCaller();
    const m = await call(ip, "troll");
    expect((await call(ip, "sibling")).status).toBe(201);
    let hidden = false;
    for (let i = 0; i < 3; i++) {
      hidden = (await live.post("/live-api/report", { messageId: m.json.id }, { ip: newCaller() })).json.hidden;
    }
    expect(hidden).toBe(true);
    expect((await call(ip, "troll")).json.error).toBe("muted");
    expect((await call(ip, "sibling")).status).toBe(201);
  });

  it("a ban holds the address: the banned browser clearing its cookie cannot start talking again, while callers already there can", async () => {
    const ip = newCaller();
    const bad = await call(ip, "banned");
    expect((await call(ip, "neighbour")).status).toBe(201);
    expect((await live.admin("ban", { messageId: bad.json.id })).status).toBe(200);
    expect((await call(ip, "banned")).status).toBe(403);

    // Cookies cleared: a new browser as far as the service can tell.
    live.clearCookies("banned");
    const listen = await live.stream({ ip, caller: "banned" });
    expect(listen.status).toBe(200); // listening is never refused
    listen.close();
    const again = await call(ip, "banned");
    expect(again.status).toBe(429);
    expect(again.json.error).toBe("address-hold");
    expect(again.json.retryAfter).toBeGreaterThan(50 * 60);
    expect((await rename(ip, "banned", `Caller ${token(6)}`)).json.error).toBe("address-hold");

    // The neighbour who was already talking is untouched...
    expect((await call(ip, "neighbour")).status).toBe(201);
    // ...and so is everyone elsewhere.
    expect((await call(newCaller(), "elsewhere")).status).toBe(201);
  });

  it("the address cap on new callers is generous, and never touches callers already talking", async () => {
    const ip = newCaller();
    expect((await call(ip, "regular")).status).toBe(201);
    let refused = null;
    for (let i = 0; i < FIRST_CALLS_PER_ADDRESS_HOUR + 1; i++) {
      const r = await call(ip, `crowd-${i}`);
      if (r.status !== 201) {
        refused = { i, r };
        break;
      }
    }
    // "regular" took one of the hour's first calls, so the cap-th newcomer is refused.
    expect(refused?.i).toBe(FIRST_CALLS_PER_ADDRESS_HOUR - 1);
    expect(refused.r.status).toBe(429);
    expect(refused.r.json.error).toBe("address-limit");
    expect((await call(ip, "regular")).status).toBe(201);
  });

  it("new browsers per address are capped, generously", async () => {
    const ip = newCaller();
    // A call with no text: every request mints a caller (no cookie is kept),
    // is refused before any other per-address cap, and claims no name.
    const newBrowser = () => live.post("/live-api/messages", { body: 5 }, { ip, jar: false });
    for (let i = 0; i < NEW_CALLERS_PER_ADDRESS_HOUR; i++) expect((await newBrowser()).status).toBe(400);
    const over = await newBrowser();
    expect(over.status).toBe(429);
    expect(over.json.error).toBe("busy-network");
  });

  it("a caller from before per-browser ids is taken over, name and all, by the first browser from that address", async () => {
    const ip = newCaller();
    const legacy = addressRef(ip, secret);
    const oldName = `Old Timer ${token(6)}`;
    await live.pool.query(
      `INSERT INTO live_names (client_ref, name, name_key, changed_at, seen_at) VALUES ($1, $2, lower($2), now() - interval '1 hour', now())`,
      [legacy, oldName],
    );
    const { rows } = await live.pool.query(
      `INSERT INTO live_messages (client_ref, caller_name, line, body) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
      [legacy, oldName, lineFor(legacy), unique("before")],
    );
    const oldId = Number(rows[0].id);

    const first = await me(ip, "heir");
    expect(first.json.name).toBe(oldName);
    expect(first.json.line).toBe(LINES[lineFor(legacy)]);
    // Their old call is theirs: reporting it is reporting your own (a no-op).
    const own = await live.post("/live-api/report", { messageId: oldId }, { ip, caller: "heir" });
    expect(own.json).toEqual({ ok: true, hidden: false });
    const { rows: reps } = await live.pool.query(`SELECT count(*)::int AS n FROM live_reports WHERE message_id = $1`, [oldId]);
    expect(reps[0].n).toBe(0);
    // A second browser from that address is somebody else.
    const second = await me(ip, "stranger");
    expect(second.json.name).not.toBe(oldName);
    // And nothing is left under the address.
    const { rows: left } = await live.pool.query(`SELECT count(*)::int AS n FROM live_names WHERE client_ref = $1`, [legacy]);
    expect(left[0].n).toBe(0);
  });
});

d("a night busy enough to hold every plain caller name", () => {
  let live;
  const onlyName = `Owl in ${token(8)}`;
  beforeAll(async () => {
    // Every plain name this app can draw is one name, held by someone on the lines.
    live = await startLive({ randomName: () => onlyName, now: () => clock });
    expect((await live.get("/live-api/me", { ip: newCaller() })).json.name).toBe(onlyName);
  });
  afterAll(async () => {
    await live?.close();
  });

  it("a new caller gets the name with a number on it, still inside the length limit", async () => {
    const r = await live.get("/live-api/me", { ip: newCaller() });
    expect(r.status).toBe(200);
    expect(r.json.name).toMatch(new RegExp(`^${onlyName} \\d{4}$`));
    expect([...r.json.name].length).toBeLessThanOrEqual(32);
  });

  it("an admin can still clear a caller's name", async () => {
    tick();
    const m = await live.post("/live-api/messages", { body: unique() }, { ip: newCaller() });
    const r = await live.admin("clear-name", { messageId: m.json.id });
    expect(r.status).toBe(200);
    expect(r.json.name).toMatch(new RegExp(`^${onlyName} \\d{4}$`));
  });
});
