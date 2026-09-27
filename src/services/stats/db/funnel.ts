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

/** The browser's class when it arrived: narrower than the app's 768 px breakpoint, or not. */
export const FUNNEL_DEVICES = ["phone", "desktop"] as const;
export type FunnelDevice = (typeof FUNNEL_DEVICES)[number];

export function isFunnelDevice(v: unknown): v is FunnelDevice {
  return typeof v === "string" && (FUNNEL_DEVICES as readonly string[]).includes(v);
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

export async function recordFunnelStep(day: string, step: FunnelStep, device: FunnelDevice): Promise<void> {
  await pool().query(
    `INSERT INTO funnel_daily (day, device, step, n) VALUES ($1::date, $3, $2, 1)
     ON CONFLICT (day, device, step) DO UPDATE SET n = funnel_daily.n + 1`,
    [day, step, device],
  );
}

export type FunnelCounts = Record<FunnelStep, number>;
export interface FunnelDay extends FunnelCounts {
  day: string;
  device: FunnelDevice;
}
export interface Funnel {
  days: number;
  /** One row per cohort day and device with any arrival or step, oldest first, phone before desktop. */
  cohorts: FunnelDay[];
  totals: FunnelCounts;
  byDevice: Record<FunnelDevice, FunnelCounts>;
}

function zero(): FunnelCounts {
  return { visit: 0, live: 0, tune: 0, call: 0 };
}

/** The cohorts of the last `days` days (today included), and their totals. */
export async function getFunnel(days: number): Promise<Funnel> {
  const { rows } = await pool().query<{ day: string; device: FunnelDevice; step: FunnelStep; n: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, device, step, n
       FROM funnel_daily
      WHERE day > (now() AT TIME ZONE 'UTC')::date - $1::int
      ORDER BY day, device DESC`,
    [days],
  );
  const byKey = new Map<string, FunnelDay>();
  const totals = zero();
  const byDevice: Record<FunnelDevice, FunnelCounts> = { phone: zero(), desktop: zero() };
  for (const r of rows) {
    const key = `${r.day}/${r.device}`;
    const row = byKey.get(key) ?? { day: r.day, device: r.device, ...zero() };
    const n = Number(r.n);
    row[r.step] = n;
    totals[r.step] += n;
    byDevice[r.device][r.step] += n;
    byKey.set(key, row);
  }
  return { days, cohorts: [...byKey.values()], totals, byDevice };
}
