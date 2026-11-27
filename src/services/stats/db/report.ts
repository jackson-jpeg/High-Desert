/**
 * The ratings report on /stats's Station tab (UI plan push 6, batch 4), and
 * the finish counter behind "Most finished". Real data only: every figure is
 * null or empty until there is enough of it to mean something.
 */

import { pool } from "./pool";

/** Finishes are counted from here; plays are compared from the same instant. */
export const FINISHES_SINCE = "2026-11-28T00:00:00Z";
/** A show needs this many plays since FINISHES_SINCE before its share is shown. */
export const MIN_FINISH_PLAYS = 5;
/** Days of daily peaks a "typical day" needs. */
export const MIN_TYPICAL_DAYS = 7;
/** The window a "typical day" is the median of. */
export const TYPICAL_WINDOW_DAYS = 28;
/** Shows in Most played this week. */
export const WEEK_ROWS = 5;

export async function recordFinish(episodeId: string): Promise<void> {
  await pool().query(`INSERT INTO play_finishes (episode_id) VALUES ($1)`, [episodeId]);
}

export interface Crowd {
  /** The most people online in one sample in the last 12 hours. */
  peak: number;
  /** The median of the daily peaks over the 28 days before today (UTC). */
  typical: number;
  days: number;
}

export interface FinishEntry {
  episodeId: string;
  plays: number;
  finishes: number;
  /** finishes / plays, at most 1. */
  share: number;
}

export interface RatingsReport {
  crowd: Crowd | null;
  /** The most played shows of the last 7 days (2+ plays), most first; the first is the hottest. */
  week: { episodeId: string; plays: number }[];
  /** US states whose first browser arrived in the last 7 days. */
  newStates: string[];
  finished: { since: string; minPlays: number; entries: FinishEntry[] };
}

export async function getRatingsReport(at: Date = new Date()): Promise<RatingsReport> {
  const p = pool();
  const now = at.toISOString();
  const [peak, typical, hot, states, fin] = await Promise.all([
    p.query<{ peak: number | null }>(
      `SELECT max(online)::int AS peak FROM listener_samples WHERE sampled_at > $1::timestamptz - interval '12 hours' AND sampled_at <= $1::timestamptz`,
      [now],
    ),
    p.query<{ typical: string | null; days: string }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY peak_online) AS typical, count(*) AS days
         FROM traffic_daily
        WHERE day < ($2::timestamptz AT TIME ZONE 'UTC')::date
          AND day >= ($2::timestamptz AT TIME ZONE 'UTC')::date - $1::int
          AND samples > 0`,
      [TYPICAL_WINDOW_DAYS, now],
    ),
    p.query<{ episode_id: string; plays: string }>(
      `SELECT episode_id, count(*) AS plays FROM play_events
        WHERE played_at > $1::timestamptz - interval '7 days' AND played_at <= $1::timestamptz
        GROUP BY episode_id HAVING count(*) >= 2
        ORDER BY count(*) DESC, episode_id LIMIT $2`,
      [now, WEEK_ROWS],
    ),
    p.query<{ region: string }>(
      `SELECT region FROM visitors
        WHERE country = 'US' AND region IS NOT NULL
          AND first_seen <= $1::timestamptz
        GROUP BY region HAVING min(first_seen) > $1::timestamptz - interval '7 days'
        ORDER BY min(first_seen) DESC, region`,
      [now],
    ),
    p.query<{ episode_id: string; plays: string; finishes: string }>(
      `WITH f AS (SELECT episode_id, count(*) AS finishes FROM play_finishes
                   WHERE finished_at >= $1::timestamptz GROUP BY episode_id),
            pl AS (SELECT episode_id, count(*) AS plays FROM play_events
                   WHERE played_at >= $1::timestamptz GROUP BY episode_id)
       SELECT pl.episode_id, pl.plays, coalesce(f.finishes, 0) AS finishes
         FROM pl LEFT JOIN f USING (episode_id)
        WHERE pl.plays >= $2`,
      [FINISHES_SINCE, MIN_FINISH_PLAYS],
    ),
  ]);

  const days = Number(typical.rows[0]?.days ?? 0);
  const peakNow = peak.rows[0]?.peak;
  const crowd =
    peakNow != null && days >= MIN_TYPICAL_DAYS && typical.rows[0]?.typical != null
      ? { peak: peakNow, typical: Math.round(Number(typical.rows[0].typical)), days }
      : null;

  const entries = fin.rows
    .map((r) => {
      const plays = Number(r.plays);
      const finishes = Number(r.finishes);
      return { episodeId: r.episode_id, plays, finishes, share: Math.min(1, finishes / plays) };
    })
    .filter((e) => e.finishes > 0)
    .sort((a, b) => b.share - a.share || b.plays - a.plays || a.episodeId.localeCompare(b.episodeId))
    .slice(0, 5);

  return {
    crowd,
    week: hot.rows.map((r) => ({ episodeId: r.episode_id, plays: Number(r.plays) })),
    newStates: states.rows.map((r) => r.region),
    finished: { since: FINISHES_SINCE, minPlays: MIN_FINISH_PLAYS, entries },
  };
}
