// @vitest-environment node
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";

/**
 * Visitors against real Postgres: a browser is one row however often it
 * comes, a new UTC day is one more visit day, the funnel's arrivals are
 * backfilled as placeholders that a browser claims (so the total never counts
 * one browser twice), the reconcile is idempotent, and the reads count what
 * the rows say.
 *
 * Parallel-safe: funnel rows and visitor days live in 2001 (funnel.db.test.ts
 * owns the last 60 days), ids carry TAG, the reconcile is scoped to 2001, and
 * totals are read as deltas.
 */

type Store = typeof import("../store");
let store: Store;

const TAG = `vt${Date.now().toString(36)}`;
const vid = (s: string) => `${TAG}_${s}`.padEnd(16, "x");
const D1 = "2001-03-01";
const D2 = "2001-03-02";
const SCOPE = { from: "2001-01-01", to: "2001-12-31" };
const GEO_CA = { country: "US", region: "California", city: null };
const GEO_NONE = { country: null, region: null, city: null };

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  store = await import("../store");
});

async function clean() {
  const db = store.getPool();
  await db.query("DELETE FROM funnel_daily WHERE day BETWEEN $1 AND $2", [SCOPE.from, SCOPE.to]);
  await db.query("DELETE FROM visitors WHERE first_day BETWEEN $1 AND $2 OR id LIKE $3", [SCOPE.from, SCOPE.to, `${TAG}%`]);
}

afterAll(async () => {
  if (!store) return;
  await clean();
  await store.getPool().query("DELETE FROM active_sessions WHERE session_id LIKE $1", [`${TAG}%`]);
  await store.getPool().query("DELETE FROM visitor_tuneins WHERE region LIKE $1 OR country = 'XB'", [`${TAG}%`]);
  await store.getPool().end();
});

beforeEach(async () => {
  await clean();
});

async function funnel(day: string, device: "phone" | "desktop", step: "visit" | "return", n: number, look: "win98" | "night" | null = null) {
  for (let i = 0; i < n; i++) await store.recordFunnelStep(day, step, device, look);
}

async function placeholders(day: string, device: string) {
  const { rows } = await store.getPool().query<{ n: string; returners: string }>(
    "SELECT count(*) AS n, count(*) FILTER (WHERE visit_days = 2) AS returners FROM visitors WHERE origin = 'funnel' AND first_day = $1 AND device = $2",
    [day, device],
  );
  return { n: Number(rows[0].n), returners: Number(rows[0].returners) };
}

async function row(id: string) {
  const { rows } = await store.getPool().query(
    `SELECT origin, to_char(first_day, 'YYYY-MM-DD') AS first_day, visit_days, device, look, country, region,
            here_before, to_char(funnel_cohort, 'YYYY-MM-DD') AS funnel_cohort
       FROM visitors WHERE id = $1`,
    [id],
  );
  return rows[0];
}

describeDb("visitors (Postgres)", () => {
  it("one browser is one row however often it posts; a new UTC day is one more visit day", async () => {
    const before = await store.getVisitorTotals();
    const id = vid("once");
    const first = await store.recordVisit({ id, device: "phone", look: "night", geo: GEO_CA });
    const again = await store.recordVisit({ id, device: "phone", look: "night", geo: GEO_NONE });
    expect(first).toEqual({ created: true, claimed: false });
    expect(again).toEqual({ created: false, claimed: false });
    // A lookup that knew nothing keeps the location it had.
    expect(await row(id)).toMatchObject({ origin: "browser", visit_days: 1, country: "US", region: "California" });

    // Yesterday, as far as the row knows: the next post is a new day.
    await store.getPool().query("UPDATE visitors SET last_day = last_day - 1 WHERE id = $1", [id]);
    await store.recordVisit({ id, device: "phone", look: "night", geo: GEO_CA });
    await store.recordVisit({ id, device: "phone", look: "night", geo: GEO_CA });
    expect((await row(id)).visit_days).toBe(2);

    const after = await store.getVisitorTotals();
    expect(after.visitors - before.visitors).toBe(1);
    expect(after.browsers - before.browsers).toBe(1);
    expect(after.returning - before.returning).toBe(1);
  });

  it("backfills one placeholder per funnel arrival, with the funnel's returns, and a rerun changes nothing", async () => {
    await funnel(D1, "phone", "visit", 5);
    await funnel(D1, "phone", "return", 2);
    await funnel(D1, "desktop", "visit", 2, "win98");
    const r1 = await store.reconcileVisitorBackfill(SCOPE);
    expect(r1).toEqual({ inserted: 7, deleted: 0, placeholders: 7 });
    expect(await placeholders(D1, "phone")).toEqual({ n: 5, returners: 2 });
    expect(await placeholders(D1, "desktop")).toEqual({ n: 2, returners: 0 });

    const r2 = await store.reconcileVisitorBackfill(SCOPE);
    expect(r2).toEqual({ inserted: 0, deleted: 0, placeholders: 7 });

    // A later arrival counted by the funnel (a tab on an old build) is picked up.
    await funnel(D1, "phone", "visit", 1);
    expect(await store.reconcileVisitorBackfill(SCOPE)).toMatchObject({ inserted: 1, placeholders: 8 });
  });

  it("the reconcile trims placeholders a claim did not remove", async () => {
    await funnel(D2, "desktop", "visit", 3);
    await store.reconcileVisitorBackfill(SCOPE);
    // Two browsers with that arrival, written as if their claims had missed
    // (a placeholder made after them, or a row restored from a backup).
    for (const s of ["t1", "t2"]) {
      await store.getPool().query(
        `INSERT INTO visitors (id, origin, device, funnel_cohort, funnel_device) VALUES ($1, 'browser', 'desktop', $2, 'desktop')`,
        [vid(s), D2],
      );
    }
    expect(await store.reconcileVisitorBackfill(SCOPE)).toEqual({ inserted: 0, deleted: 2, placeholders: 1 });
    expect(await placeholders(D2, "desktop")).toEqual({ n: 1, returners: 0 });
  });

  it("a browser naming its funnel arrival claims one placeholder: the total does not move", async () => {
    await funnel(D1, "phone", "visit", 3, "win98");
    await funnel(D1, "desktop", "visit", 1, "win98");
    await store.reconcileVisitorBackfill(SCOPE);
    const before = await store.getVisitorTotals();

    const id = vid("claim");
    const res = await store.recordVisit({
      id, device: "desktop", look: "night", geo: GEO_CA, cohort: D1, cohortDevice: "phone", cohortLook: "win98",
    });
    expect(res).toEqual({ created: true, claimed: true });
    expect(await placeholders(D1, "phone")).toEqual({ n: 2, returners: 0 });
    // Control: the other device's placeholder is still there.
    expect(await placeholders(D1, "desktop")).toEqual({ n: 1, returners: 0 });
    // The row is the arrival: its day and device, and it came again later.
    expect(await row(id)).toMatchObject({ first_day: D1, device: "phone", funnel_cohort: D1, visit_days: 2, here_before: false });

    const after = await store.getVisitorTotals();
    expect(after.visitors).toBe(before.visitors);
    expect(after.backfilled - before.backfilled).toBe(-1);
    expect(after.browsers - before.browsers).toBe(1);

    // The reconcile agrees with the claim: it does not put the placeholder back.
    expect(await store.reconcileVisitorBackfill(SCOPE)).toMatchObject({ inserted: 0, deleted: 0, placeholders: 3 });
    // A second post claims nothing more.
    expect(await store.recordVisit({ id, device: "phone", look: null, geo: GEO_CA, cohort: D1, cohortDevice: "phone" })).toEqual({
      created: false,
      claimed: false,
    });
    expect(await placeholders(D1, "phone")).toEqual({ n: 2, returners: 0 });
  });

  it("a browser first seen without its arrival claims when it later names one", async () => {
    await funnel(D2, "phone", "visit", 2);
    await store.reconcileVisitorBackfill(SCOPE);
    const id = vid("late");
    await store.recordVisit({ id, device: "phone", look: null, geo: GEO_NONE });
    expect(await placeholders(D2, "phone")).toEqual({ n: 2, returners: 0 });
    const res = await store.recordVisit({ id, device: "phone", look: null, geo: GEO_NONE, cohort: D2, cohortDevice: "phone" });
    expect(res).toEqual({ created: false, claimed: true });
    expect(await placeholders(D2, "phone")).toEqual({ n: 1, returners: 0 });
    expect(await row(id)).toMatchObject({ first_day: D2, funnel_cohort: D2 });
  });

  it("a cohort with no placeholder left claims nothing and deletes nothing else", async () => {
    await funnel(D1, "phone", "visit", 1);
    await store.reconcileVisitorBackfill(SCOPE);
    await store.recordVisit({ id: vid("c1"), device: "phone", look: null, geo: GEO_NONE, cohort: D1, cohortDevice: "phone" });
    const res = await store.recordVisit({ id: vid("c2"), device: "phone", look: null, geo: GEO_NONE, cohort: D1, cohortDevice: "phone" });
    expect(res).toEqual({ created: true, claimed: false });
    // Two browsers for one counted arrival: the reconcile leaves zero, not minus one.
    expect(await store.reconcileVisitorBackfill(SCOPE)).toMatchObject({ placeholders: 0 });
  });

  it("a browser from before the funnel is marked here_before, and loses the mark once it names an arrival", async () => {
    const id = vid("before");
    await store.recordVisit({ id, device: "desktop", look: "win98", geo: GEO_CA, hereBefore: true });
    expect((await row(id)).here_before).toBe(true);
    // Control: a browser with a cohort is never here_before, whatever it says.
    const id2 = vid("notbefore");
    await store.recordVisit({ id: id2, device: "desktop", look: null, geo: GEO_CA, hereBefore: true, cohort: D2, cohortDevice: "desktop" });
    expect((await row(id2)).here_before).toBe(false);
  });

  it("locations: all time by latest location, the unknown bucket last; right now from presence", async () => {
    const region = `${TAG} Region`;
    const before = await store.getVisitorLocations();
    const xa = (b: typeof before.allTime) => b.countries.find((c) => c.country === "XA")?.n ?? 0;
    const st = (b: typeof before.allTime) => b.states.find((s) => s.region === region)?.n ?? 0;

    await store.recordVisit({ id: vid("l1"), device: "phone", look: null, geo: { country: "XA", region: "Somewhere", city: null } });
    await store.recordVisit({ id: vid("l2"), device: "phone", look: null, geo: { country: "US", region, city: null } });
    await store.recordVisit({ id: vid("l3"), device: "phone", look: null, geo: { country: "US", region, city: null } });
    // Two sessions from one client right now: one person.
    await store.recordHeartbeat(`${TAG}-s1`, null, "198.51.100.211", false, { country: "US", region });
    await store.recordHeartbeat(`${TAG}-s2`, null, "198.51.100.211", false, { country: "US", region });

    const after = await store.getVisitorLocations();
    expect(xa(after.allTime) - xa(before.allTime)).toBe(1);
    expect(st(after.allTime) - st(before.allTime)).toBe(2);
    expect(st(after.week) - st(before.week)).toBe(2);
    expect(st(after.now) - st(before.now)).toBe(1);
    const last = after.allTime.countries.at(-1);
    if (after.allTime.countries.some((c) => c.country === null)) expect(last?.country).toBeNull();
  });

  it("a heartbeat reports a tune-in only on the beat that tunes in", async () => {
    const s = `${TAG}-tune`;
    const ip = "203.0.113.211";
    expect(await store.recordHeartbeat(s, null, ip, false)).toEqual({ tunedIn: false });
    expect(await store.recordHeartbeat(s, null, ip, true)).toEqual({ tunedIn: true });
    expect(await store.recordHeartbeat(s, null, ip, true)).toEqual({ tunedIn: false });
    expect(await store.recordHeartbeat(s, null, ip, false)).toEqual({ tunedIn: false });
    expect(await store.recordHeartbeat(s, null, ip, true)).toEqual({ tunedIn: true });
    // A brand-new session that is live on its first beat tunes in too.
    expect(await store.recordHeartbeat(`${TAG}-tune2`, null, ip, true)).toEqual({ tunedIn: true });
  });

  it("the tune-in feed is newest first, at most 10, and drops a city with no region", async () => {
    const region = `${TAG} Feed`;
    for (let i = 0; i < 12; i++) await store.recordTuneIn({ country: "US", region: `${region} ${i}`, city: null });
    await store.recordTuneIn({ country: "XB", region: null, city: "Nowhere" });
    await store.recordTuneIn({ country: "US", region: `${region} last`, city: "Pahrump" });
    const feed = await store.getTuneIns();
    expect(feed).toHaveLength(10);
    expect(feed[0]).toMatchObject({ region: `${region} last`, city: "Pahrump" });
    expect(feed[1]).toMatchObject({ region: null, city: null });
    expect(feed[2].region).toBe(`${region} 11`);
  });

  it("records: the biggest crowd counts only days since online counted people", async () => {
    const db = store.getPool();
    await db.query(
      `INSERT INTO traffic_daily (day, peak_online, peak_listening, plays, peak_at) VALUES
         ('2001-01-01', 999999, 5, 999999999, '2001-01-01T03:00:00Z'),
         ('2099-01-01', 99999, 7, 1, '2099-01-01T04:00:00Z')
       ON CONFLICT (day) DO UPDATE SET peak_online = EXCLUDED.peak_online, peak_listening = EXCLUDED.peak_listening,
         plays = EXCLUDED.plays, peak_at = EXCLUDED.peak_at`,
    );
    await db.query(`INSERT INTO episode_plays (episode_id, plays) VALUES ($1, 999999999999)
                    ON CONFLICT (episode_id) DO UPDATE SET plays = EXCLUDED.plays`, [`${TAG}-ep`]);
    try {
      const r = await store.getRecords();
      expect(r.biggestCrowd).toEqual({ online: 99999, listening: 7, at: "2099-01-01T04:00:00.000Z", day: "2099-01-01", since: "2026-09-24" });
      expect(r.biggestDay).toEqual({ day: "2001-01-01", plays: 999999999 });
      expect(r.mostPlayed).toEqual({ episodeId: `${TAG}-ep`, plays: 999999999999 });
    } finally {
      await db.query("DELETE FROM traffic_daily WHERE day IN ('2001-01-01', '2099-01-01')");
      await db.query("DELETE FROM episode_plays WHERE episode_id = $1", [`${TAG}-ep`]);
    }
  });

  it("refuses a placeholder-shaped id from a browser, and the table refuses an address-shaped country", async () => {
    expect(store.isVisitorId("funnel-0123456789abcdef")).toBe(false);
    expect(store.isVisitorId("0123456789abcdef")).toBe(true);
    await expect(
      store.recordVisit({ id: vid("bad"), device: "phone", look: null, geo: { country: "203.0.113.9", region: null, city: null } }),
    ).rejects.toThrow(/visitors_country_check/);
  });
});
