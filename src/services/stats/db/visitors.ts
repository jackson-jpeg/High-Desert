/**
 * Visitors: one row per browser, where they are, and the records
 * (docs/visitors.md). See `visitors` and `visitor_tuneins` in
 * scripts/schema.sql.
 *
 * A browser keeps a random id (src/services/stats/visitor-client.ts) and
 * posts it once per page load. The address the post came from is looked up
 * in the self-hosted geo database by the route and dropped; only the country
 * and region it resolved to are stored here.
 *
 * Before this table, the arrival funnel was the only per-browser count. Its
 * arrivals are backfilled as placeholder rows (`origin = 'funnel'`) that a
 * browser claims when it first posts with its own funnel arrival, so nobody
 * is counted twice (src/lib/stats/visitor-backfill.ts).
 */

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./pool";
import { ACTIVE_WINDOW_MS, PRESENCE_WHO } from "./presence";
import type { GeoResult } from "@/lib/geo/geoip";
import type { Look } from "@/lib/look/look";
import {
  planPlaceholders,
  type BackfillDevice,
  type BackfillLook,
  type DayDeviceCount,
  type DayDeviceLookCount,
} from "@/lib/stats/visitor-backfill";

export type VisitorDevice = BackfillDevice;

/** The day the funnel began, and with it the first day any browser was counted once. */
export const COUNTING_SINCE_FALLBACK = "2026-09-27";
/**
 * The day `online` began counting people rather than page loads
 * (listener_samples, 2026-09-24). A crowd before it is not comparable.
 */
export const CROWDS_COMPARABLE_FROM = "2026-09-24";
export const TUNEIN_RETENTION_DAYS = 7;
export const TUNEIN_FEED_LIMIT = 10;

const VISITOR_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** Placeholder ids are ours: a browser may not post one. */
const PLACEHOLDER_PREFIX = "funnel-";

export function isVisitorId(v: unknown): v is string {
  return typeof v === "string" && VISITOR_ID_RE.test(v) && !v.startsWith(PLACEHOLDER_PREFIX);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isCohortDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v && t <= Date.now() + 86_400_000;
}

/** One lock for every write that moves placeholders: a claim and the reconcile. */
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('hd-visitors-placeholders', 0))";

async function inTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface VisitInput {
  id: string;
  /** The device now; the row keeps the funnel's arrival device when there is one. */
  device: VisitorDevice;
  look: Look | null;
  geo: GeoResult;
  /** The browser's own funnel arrival, if it has one. */
  cohort?: string | null;
  cohortDevice?: VisitorDevice | null;
  cohortLook?: Look | null;
  /** The browser arrived with a library already in it: a visitor from before the funnel. */
  hereBefore?: boolean;
}

export interface VisitResult {
  /** A browser this table had not seen. */
  created: boolean;
  /** It took a backfilled placeholder's place (so the total did not move). */
  claimed: boolean;
}

/** Whether this id is already a row. The route asks first, to cap new ids per client. */
export async function visitorExists(id: string): Promise<boolean> {
  const { rowCount } = await pool().query("SELECT 1 FROM visitors WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * A browser was here. Creates its row or renews it: last seen now, one more
 * visit day when today is a new UTC day for it, the latest location (kept
 * when this lookup knew nothing). When the browser names a funnel arrival it
 * had not named before, one placeholder for that arrival is deleted in the
 * same transaction, and the row takes the arrival's day as its first.
 */
export async function recordVisit(v: VisitInput): Promise<VisitResult> {
  const cohort = v.cohort && isCohortDay(v.cohort) ? v.cohort : null;
  const arrivalDevice = cohort ? (v.cohortDevice ?? v.device) : v.device;
  const arrivalLook = cohort ? (v.cohortLook ?? null) : null;
  return inTransaction(async (c) => {
    await c.query(LOCK_SQL);
    const prev = await c.query<{ funnel_cohort: string | null }>(
      "SELECT to_char(funnel_cohort, 'YYYY-MM-DD') AS funnel_cohort FROM visitors WHERE id = $1 FOR UPDATE",
      [v.id],
    );
    const created = prev.rowCount === 0;
    const newCohort = cohort !== null && (created || prev.rows[0].funnel_cohort === null);

    if (created) {
      await c.query(
        `INSERT INTO visitors (id, origin, first_seen, last_seen, first_day, last_day, visit_days, device, look,
                               country, region, here_before, funnel_cohort, funnel_device, funnel_look)
         SELECT $1, 'browser',
                LEAST(now(), COALESCE($7::date::timestamp AT TIME ZONE 'UTC', now())), now(),
                LEAST(today, COALESCE($7::date, today)), today,
                CASE WHEN $7::date IS NOT NULL AND $7::date < today THEN 2 ELSE 1 END,
                $2, $3, $4, $5, $6::boolean AND $7::date IS NULL, $7::date, $8, $9
         FROM (SELECT (now() AT TIME ZONE 'UTC')::date AS today) t`,
        [v.id, arrivalDevice, v.look, v.geo.country, v.geo.region, v.hereBefore === true, cohort, cohort ? arrivalDevice : null, arrivalLook],
      );
    } else {
      await c.query(
        `UPDATE visitors SET
           last_seen  = now(),
           visit_days = visit_days + CASE WHEN last_day < today THEN 1 ELSE 0 END,
           last_day   = GREATEST(last_day, today),
           look       = COALESCE($2, look),
           country    = COALESCE($3, country),
           region     = CASE WHEN $3::text IS NOT NULL THEN $4 ELSE region END,
           here_before   = here_before OR ($5::boolean AND funnel_cohort IS NULL AND $6::date IS NULL),
           funnel_cohort = COALESCE(funnel_cohort, $6::date),
           funnel_device = COALESCE(funnel_device, $7),
           funnel_look   = CASE WHEN funnel_cohort IS NULL THEN $8 ELSE funnel_look END,
           device        = CASE WHEN funnel_cohort IS NULL AND $6::date IS NOT NULL THEN $7 ELSE device END,
           first_day     = CASE WHEN $6::date IS NOT NULL THEN LEAST(first_day, $6::date) ELSE first_day END,
           first_seen    = CASE WHEN $6::date IS NOT NULL THEN LEAST(first_seen, $6::date::timestamp AT TIME ZONE 'UTC') ELSE first_seen END
         FROM (SELECT (now() AT TIME ZONE 'UTC')::date AS today) t
         WHERE id = $1`,
        [v.id, v.look, v.geo.country, v.geo.region, v.hereBefore === true, cohort, cohort ? arrivalDevice : null, arrivalLook],
      );
    }

    let claimed = false;
    if (newCohort) {
      // The same browser as one of the funnel's arrivals that day: its
      // placeholder goes. Same look first; any look of that day and device next.
      const del = await c.query(
        `DELETE FROM visitors WHERE id = (
           SELECT id FROM visitors
            WHERE origin = 'funnel' AND first_day = $1::date AND device = $2
            ORDER BY (look IS NOT DISTINCT FROM $3) DESC, id
            LIMIT 1)`,
        [cohort, arrivalDevice, arrivalLook],
      );
      claimed = (del.rowCount ?? 0) > 0;
    }
    return { created, claimed };
  });
}

export interface ReconcileResult {
  inserted: number;
  deleted: number;
  placeholders: number;
}

/**
 * Make the placeholders equal to the funnel's arrivals minus the browsers
 * that claimed them, per (day, device, look), and their visit days equal to
 * the funnel's returns (planPlaceholders). Idempotent: run on every traffic
 * sample, so arrivals counted by a tab still on an old build are backfilled
 * within two minutes, and a second run changes nothing.
 */
export async function reconcileVisitorBackfill(
  /** Tests only: reconcile just these UTC days, so a DB test running in parallel cannot move the result. */
  scope: { from: string; to: string } | null = null,
): Promise<ReconcileResult> {
  const range = [scope?.from ?? null, scope?.to ?? null];
  const within = (col: string) => `($1::date IS NULL OR ${col} BETWEEN $1::date AND $2::date)`;
  return inTransaction(async (c) => {
    await c.query(LOCK_SQL);
    // One connection runs these in turn; sequential keeps that plain.
    const arrivals = await c.query<DayDeviceLookCount & { n: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, device, look, sum(n) AS n
         FROM funnel_daily WHERE step = 'visit' AND NOT again AND ${within("day")} GROUP BY 1, 2, 3`,
      range,
    );
    const returns = await c.query<DayDeviceCount & { n: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, device, sum(n) AS n
         FROM funnel_daily WHERE step = 'return' AND NOT again AND ${within("day")} GROUP BY 1, 2`,
      range,
    );
    const claimed = await c.query<DayDeviceLookCount & { n: string }>(
      `SELECT to_char(funnel_cohort, 'YYYY-MM-DD') AS day, funnel_device AS device, funnel_look AS look, count(*) AS n
         FROM visitors WHERE origin = 'browser' AND funnel_cohort IS NOT NULL AND ${within("funnel_cohort")} GROUP BY 1, 2, 3`,
      range,
    );
    const existing = await c.query<{ day: string; device: BackfillDevice; look: BackfillLook; n: string }>(
      `SELECT to_char(first_day, 'YYYY-MM-DD') AS day, device, look, count(*) AS n
         FROM visitors WHERE origin = 'funnel' AND ${within("first_day")} GROUP BY 1, 2, 3`,
      range,
    );
    const num = <T extends { n: string | number }>(rows: T[]) => rows.map((r) => ({ ...r, n: Number(r.n) }));
    const plan = planPlaceholders(num(arrivals.rows), num(returns.rows), num(claimed.rows));

    const want = new Map<string, number>();
    for (const p of plan) {
      for (const [l, n] of Object.entries(p.looks)) if (n > 0) want.set(`${p.day}|${p.device}|${l}`, n);
    }
    const have = new Map<string, number>();
    for (const r of existing.rows) have.set(`${r.day}|${r.device}|${r.look ?? "none"}`, Number(r.n));

    let inserted = 0;
    let deleted = 0;
    for (const key of new Set([...want.keys(), ...have.keys()])) {
      const [day, device, l] = key.split("|");
      const look = l === "none" ? null : l;
      const diff = (want.get(key) ?? 0) - (have.get(key) ?? 0);
      if (diff > 0) {
        const ids = Array.from({ length: diff }, () => `${PLACEHOLDER_PREFIX}${randomUUID().replace(/-/g, "")}`);
        await c.query(
          `INSERT INTO visitors (id, origin, first_seen, last_seen, first_day, last_day, device, look)
           SELECT id, 'funnel', $2::date::timestamp AT TIME ZONE 'UTC', $2::date::timestamp AT TIME ZONE 'UTC',
                  $2::date, $2::date, $3, $4
             FROM unnest($1::text[]) AS id`,
          [ids, day, device, look],
        );
        inserted += diff;
      } else if (diff < 0) {
        const res = await c.query(
          `DELETE FROM visitors WHERE id IN (
             SELECT id FROM visitors
              WHERE origin = 'funnel' AND first_day = $1::date AND device = $2 AND look IS NOT DISTINCT FROM $3
              ORDER BY id DESC LIMIT $4)`,
          [day, device, look, -diff],
        );
        deleted += res.rowCount ?? 0;
      }
    }

    // Visit days: the first `returners` placeholders of each day and device
    // (by id, so a rerun picks the same ones) count two days, the rest one.
    if (plan.length > 0) {
      await c.query(
        `WITH plan AS (
           SELECT * FROM unnest($1::date[], $2::text[], $3::int[]) AS p(day, device, returners)
         ), ranked AS (
           SELECT v.id, row_number() OVER (PARTITION BY v.first_day, v.device ORDER BY v.id) AS rn, p.returners
             FROM visitors v JOIN plan p ON p.day = v.first_day AND p.device = v.device
            WHERE v.origin = 'funnel'
         )
         UPDATE visitors v SET visit_days = CASE WHEN r.rn <= r.returners THEN 2 ELSE 1 END
           FROM ranked r
          WHERE v.id = r.id AND v.visit_days <> CASE WHEN r.rn <= r.returners THEN 2 ELSE 1 END`,
        [plan.map((p) => p.day), plan.map((p) => p.device), plan.map((p) => p.returners)],
      );
    }

    const { rows } = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM visitors WHERE origin = 'funnel' AND ${within("first_day")}`,
      range,
    );
    return { inserted, deleted, placeholders: Number(rows[0].n) };
  });
}

/** A tab tuned in to the live station, from here. */
export async function recordTuneIn(geo: GeoResult): Promise<void> {
  await pool().query(
    "INSERT INTO visitor_tuneins (country, region, city) VALUES ($1, $2, $3)",
    [geo.country, geo.region, geo.region ? geo.city : null],
  );
}

export async function pruneTuneIns(): Promise<number> {
  const { rowCount } = await pool().query(
    `DELETE FROM visitor_tuneins WHERE at < now() - make_interval(days => $1)`,
    [TUNEIN_RETENTION_DAYS],
  );
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface VisitorTotals {
  /** The first day any browser was counted: the earliest funnel arrival. */
  countingSince: string;
  /** Every browser counted once: browsers seen plus backfilled arrivals not yet claimed. */
  visitors: number;
  /** Rows with an id: browsers that have posted since this table began. */
  browsers: number;
  /** Funnel arrivals from before, still placeholders (no location). */
  backfilled: number;
  /** Of the browsers, those that were visitors before `countingSince`. */
  hereBefore: number;
  /** First seen in the last 7 days. */
  newThisWeek: number;
  /** Seen in the last 7 days. */
  activeThisWeek: number;
  /** Seen on two or more UTC days. */
  returning: number;
}

export async function getVisitorTotals(): Promise<VisitorTotals> {
  const [{ rows }, since] = await Promise.all([
    pool().query<Record<string, string>>(
      `SELECT count(*) AS visitors,
              count(*) FILTER (WHERE origin = 'browser') AS browsers,
              count(*) FILTER (WHERE origin = 'funnel') AS backfilled,
              count(*) FILTER (WHERE here_before) AS here_before,
              count(*) FILTER (WHERE first_seen >= now() - interval '7 days' AND NOT here_before) AS new_week,
              count(*) FILTER (WHERE last_seen >= now() - interval '7 days') AS active_week,
              count(*) FILTER (WHERE visit_days >= 2) AS returning
         FROM visitors`,
    ),
    pool().query<{ day: string | null }>(
      `SELECT to_char(least(
                (SELECT min(day) FROM funnel_daily WHERE step = 'visit'),
                (SELECT min(first_day) FROM visitors WHERE NOT here_before)), 'YYYY-MM-DD') AS day`,
    ),
  ]);
  const r = rows[0];
  return {
    countingSince: since.rows[0]?.day ?? COUNTING_SINCE_FALLBACK,
    visitors: Number(r.visitors),
    browsers: Number(r.browsers),
    backfilled: Number(r.backfilled),
    hereBefore: Number(r.here_before),
    newThisWeek: Number(r.new_week),
    activeThisWeek: Number(r.active_week),
    returning: Number(r.returning),
  };
}

export interface PlaceCount {
  /** ISO 3166-1 alpha-2, or null: not known. */
  country: string | null;
  n: number;
}
export interface RegionCount {
  region: string | null;
  n: number;
}
export interface LocationBreakdown {
  /** Most first; the unknown bucket (null) included, last. */
  countries: PlaceCount[];
  /** United States only, by state; unknown state (null) last. */
  states: RegionCount[];
  total: number;
}
export interface VisitorLocations {
  allTime: LocationBreakdown;
  week: LocationBreakdown;
  now: LocationBreakdown;
}

function breakdown(countries: { country: string | null; n: string }[], states: { region: string | null; n: string }[]): LocationBreakdown {
  const byN = <T extends { n: number }>(a: T, b: T, ka: string | null, kb: string | null) =>
    (ka === null ? 1 : 0) - (kb === null ? 1 : 0) || b.n - a.n || String(ka).localeCompare(String(kb));
  const c = countries.map((r) => ({ country: r.country, n: Number(r.n) })).sort((a, b) => byN(a, b, a.country, b.country));
  const s = states.map((r) => ({ region: r.region, n: Number(r.n) })).sort((a, b) => byN(a, b, a.region, b.region));
  return { countries: c, states: s, total: c.reduce((t, r) => t + r.n, 0) };
}

/**
 * Visitors by country and US state: all time (every row, by its latest
 * location), this week (seen in the last 7 days) and right now (the presence
 * set: distinct clients with a heartbeat in the active window, by where their
 * heartbeat resolved).
 */
export async function getVisitorLocations(): Promise<VisitorLocations> {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const q = <T extends object>(sql: string, params: unknown[] = []) => pool().query<T & { n: string }>(sql, params).then((r) => r.rows);
  const [ac, as, wc, ws, nc, ns] = await Promise.all([
    q<{ country: string | null }>("SELECT country, count(*) AS n FROM visitors GROUP BY 1"),
    q<{ region: string | null }>("SELECT region, count(*) AS n FROM visitors WHERE country = 'US' GROUP BY 1"),
    q<{ country: string | null }>("SELECT country, count(*) AS n FROM visitors WHERE last_seen >= now() - interval '7 days' GROUP BY 1"),
    q<{ region: string | null }>(
      "SELECT region, count(*) AS n FROM visitors WHERE country = 'US' AND last_seen >= now() - interval '7 days' GROUP BY 1",
    ),
    q<{ country: string | null }>(
      `SELECT country, count(DISTINCT ${PRESENCE_WHO}) AS n FROM active_sessions WHERE seen_at >= $1 GROUP BY 1`,
      [cutoff],
    ),
    q<{ region: string | null }>(
      `SELECT region, count(DISTINCT ${PRESENCE_WHO}) AS n FROM active_sessions
        WHERE seen_at >= $1 AND country = 'US' GROUP BY 1`,
      [cutoff],
    ),
  ]);
  return { allTime: breakdown(ac, as), week: breakdown(wc, ws), now: breakdown(nc, ns) };
}

export interface TuneIn {
  at: string;
  country: string | null;
  region: string | null;
  city: string | null;
}

/** The last tune-ins, newest first. Only rows with at least a country: "from somewhere" is not a line. */
export async function getTuneIns(limit = TUNEIN_FEED_LIMIT): Promise<TuneIn[]> {
  const { rows } = await pool().query<{ at: Date; country: string; region: string | null; city: string | null }>(
    `SELECT at, country, region, city FROM visitor_tuneins
      WHERE country IS NOT NULL ORDER BY at DESC, id DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ at: new Date(r.at).toISOString(), country: r.country, region: r.region, city: r.city }));
}

export interface Records {
  /** Most people online at once, from the 2-minute samples (people, not page loads, from CROWDS_COMPARABLE_FROM). */
  biggestCrowd: { online: number; listening: number; at: string | null; day: string; since: string } | null;
  /** Most plays in one UTC day. */
  biggestDay: { day: string; plays: number } | null;
  /** Most new browsers in one UTC day (the funnel's arrivals). */
  biggestArrivalDay: { day: string; visitors: number } | null;
  /** The most played episode, all time (episode_plays: the counter that predates the event log). */
  mostPlayed: { episodeId: string; plays: number } | null;
}

export async function getRecords(): Promise<Records> {
  const [crowd, day, arrivals, played] = await Promise.all([
    pool().query<{ day: string; peak_online: number; peak_listening: number; peak_at: Date | null }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, peak_online, peak_listening, peak_at
         FROM traffic_daily WHERE day >= $1::date AND peak_online > 0
        ORDER BY peak_online DESC, peak_at NULLS LAST, day LIMIT 1`,
      [CROWDS_COMPARABLE_FROM],
    ),
    pool().query<{ day: string; plays: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, plays FROM traffic_daily WHERE plays > 0 ORDER BY plays DESC, day LIMIT 1`,
    ),
    pool().query<{ day: string; n: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, sum(n) AS n FROM funnel_daily
        WHERE step = 'visit' AND NOT again GROUP BY day ORDER BY sum(n) DESC, day LIMIT 1`,
    ),
    pool().query<{ episode_id: string; plays: string }>(
      "SELECT episode_id, plays FROM episode_plays ORDER BY plays DESC, episode_id LIMIT 1",
    ),
  ]);
  const c = crowd.rows[0];
  const d = day.rows[0];
  const a = arrivals.rows[0];
  const p = played.rows[0];
  return {
    biggestCrowd: c
      ? { online: c.peak_online, listening: c.peak_listening, at: c.peak_at ? new Date(c.peak_at).toISOString() : null, day: c.day, since: CROWDS_COMPARABLE_FROM }
      : null,
    biggestDay: d ? { day: d.day, plays: Number(d.plays) } : null,
    biggestArrivalDay: a ? { day: a.day, visitors: Number(a.n) } : null,
    mostPlayed: p ? { episodeId: p.episode_id, plays: Number(p.plays) } : null,
  };
}
