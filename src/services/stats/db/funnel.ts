/**
 * The arrival funnel: of the browsers that first arrived on a day, how many
 * saw the Live screen, tuned in, and made a first call. Counters per (day,
 * step) and nothing else — see `funnel_daily` in scripts/schema.sql and
 * docs/funnel.md. The browser decides "first" and its cohort day
 * (src/services/stats/funnel-client.ts); this module only adds one.
 */

import { pool } from "./pool";

export const FUNNEL_STEPS = ["visit", "live", "tune", "call"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export function isFunnelStep(v: unknown): v is FunnelStep {
  return typeof v === "string" && (FUNNEL_STEPS as readonly string[]).includes(v);
}

/** A cohort may be this old and still take a later step. */
export const FUNNEL_COHORT_MAX_AGE_DAYS = 30;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A cohort day the server will accept: a real UTC date, no older than
 * FUNNEL_COHORT_MAX_AGE_DAYS and no later than tomorrow (a browser's clock
 * a few hours ahead of ours is not a lie worth refusing).
 */
export function isAcceptableCohort(day: unknown, nowMs = Date.now()): day is string {
  if (typeof day !== "string" || !DAY_RE.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== day) return false;
  const today = Date.parse(`${new Date(nowMs).toISOString().slice(0, 10)}T00:00:00Z`);
  return t >= today - FUNNEL_COHORT_MAX_AGE_DAYS * 86_400_000 && t <= today + 86_400_000;
}

export async function recordFunnelStep(day: string, step: FunnelStep): Promise<void> {
  await pool().query(
    `INSERT INTO funnel_daily (day, step, n) VALUES ($1::date, $2, 1)
     ON CONFLICT (day, step) DO UPDATE SET n = funnel_daily.n + 1`,
    [day, step],
  );
}

export type FunnelCounts = Record<FunnelStep, number>;
export interface FunnelDay extends FunnelCounts {
  day: string;
}
export interface Funnel {
  days: number;
  /** One row per cohort day with any arrival or step, oldest first. */
  cohorts: FunnelDay[];
  totals: FunnelCounts;
}

function zero(): FunnelCounts {
  return { visit: 0, live: 0, tune: 0, call: 0 };
}

/** The cohorts of the last `days` days (today included), and their totals. */
export async function getFunnel(days: number): Promise<Funnel> {
  const { rows } = await pool().query<{ day: string; step: FunnelStep; n: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, step, n
       FROM funnel_daily
      WHERE day > (now() AT TIME ZONE 'UTC')::date - $1::int
      ORDER BY day`,
    [days],
  );
  const byDay = new Map<string, FunnelDay>();
  const totals = zero();
  for (const r of rows) {
    const row = byDay.get(r.day) ?? { day: r.day, ...zero() };
    row[r.step] = Number(r.n);
    totals[r.step] += Number(r.n);
    byDay.set(r.day, row);
  }
  return { days, cohorts: [...byDay.values()], totals };
}
