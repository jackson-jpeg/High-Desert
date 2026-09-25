/**
 * Traffic: the sampler's snapshots, the hour-of-day profile, the permanent
 * daily rollup and the bucketed history /api/stats/traffic serves.
 */

import { pool } from "./pool";
import { getPresence, type Presence } from "./presence";

/** How long traffic samples are kept. */
const SAMPLE_RETENTION_DAYS = 90;
/**
 * How long a play event keeps its session reference. After this it is NULLed
 * out and the row becomes what recent_plays always was — an episode and a time,
 * attached to nobody. The event itself is kept forever.
 */
const SESSION_REF_RETENTION_DAYS = 90;
/**
 * How many trailing days the daily rollup recomputes on each pass. More than
 * one so a sample that lands either side of midnight, or a backfill, is picked
 * up instead of being frozen into whichever day it was first counted under.
 */
const ROLLUP_DAYS = 3;

// ---------------------------------------------------------------------------
// Hour-of-day profile
// ---------------------------------------------------------------------------

export interface HourBucket {
  /** Hour of day in UTC, 0-23. Clients rotate this into local time. */
  hour: number;
  /** Mean concurrent visitors during that hour, across the window. */
  online: number;
  listening: number;
  /** Total plays that started during that hour, across the window. */
  plays: number;
  /**
   * How many samples this hour was built from. Zero means never observed,
   * which is a different statement from "observed, nobody here" — without it
   * a freshly-deployed sampler draws a profile that looks like a dead site.
   */
  samples: number;
}

/** How far back the hour-of-day profile looks. */
const HOURLY_WINDOW_DAYS = 30;

/**
 * Average activity by hour of day — "when is this place awake".
 *
 * Returns all 24 hours, zero-filled, so the client can render a fixed 24-bar
 * axis without inventing gaps. Hours are UTC; the client shifts them, because
 * the answer a visitor wants is about *their* night, and Art Bell's audience
 * was never in one timezone anyway.
 */
export async function getHourlyActivity(): Promise<HourBucket[]> {
  const since = new Date(Date.now() - HOURLY_WINDOW_DAYS * 86_400_000);

  const { rows } = await pool().query<{
    hour: number;
    online: string;
    listening: string;
    plays: string;
    samples: string;
  }>(
    `
    WITH deltas AS (
      SELECT
        sampled_at,
        online,
        listening,
        GREATEST(
          0,
          total_plays - lag(total_plays) OVER (ORDER BY sampled_at)
        ) AS plays
      FROM listener_samples
      WHERE sampled_at >= $1
    )
    SELECT
      extract(hour FROM sampled_at)::int AS hour,
      avg(online)                        AS online,
      avg(listening)                     AS listening,
      COALESCE(sum(plays), 0)            AS plays,
      count(*)                           AS samples
    FROM deltas
    GROUP BY hour
    `,
    [since],
  );

  const byHour = new Map(rows.map((r) => [Number(r.hour), r]));
  return Array.from({ length: 24 }, (_, hour) => {
    const r = byHour.get(hour);
    return {
      hour,
      online: r ? Number(Number(r.online).toFixed(2)) : 0,
      listening: r ? Number(Number(r.listening).toFixed(2)) : 0,
      plays: r ? Number(r.plays) : 0,
      samples: r ? Number(r.samples) : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Traffic history
// ---------------------------------------------------------------------------

/**
 * Snapshot current presence and the running play total, and prune old samples.
 *
 * Driven by a systemd timer rather than sampled lazily on read: sampling on
 * read would record nothing during quiet periods, so an empty stretch would be
 * indistinguishable from a gap in collection. A timer records the zeroes.
 */
export async function recordSample(): Promise<Presence & { totalPlays: number }> {
  const presence = await getPresence();
  const cutoff = new Date(Date.now() - SAMPLE_RETENTION_DAYS * 86_400_000);

  const { rows } = await pool().query<{ total_plays: string }>(
    `
    WITH pruned AS (
      DELETE FROM listener_samples WHERE sampled_at < $3
    ), total AS (
      SELECT COALESCE(sum(plays), 0) AS total_plays FROM episode_plays
    )
    INSERT INTO listener_samples (sampled_at, online, listening, total_plays)
    SELECT date_trunc('minute', now()), $1, $2, total.total_plays FROM total
    ON CONFLICT (sampled_at) DO UPDATE SET
      online      = EXCLUDED.online,
      listening   = EXCLUDED.listening,
      total_plays = EXCLUDED.total_plays
    RETURNING total_plays
    `,
    [presence.online, presence.listening, cutoff],
  );

  return { ...presence, totalPlays: Number(rows[0]?.total_plays ?? 0) };
}

// ---------------------------------------------------------------------------
// Permanent history
//
// listener_samples is pruned at 90 days and recent_plays at 24 hours, so these
// two functions are what stops the record from ending at the prune horizon.
// Both are driven by the same two-minute timer that writes samples.
// ---------------------------------------------------------------------------

/**
 * The daily rollup, as one statement so tests and docs/perf.md can EXPLAIN the
 * exact text production runs. `$1` is the trailing window in days.
 *
 * The window predicates compare the **bare** timestamp columns against a
 * computed UTC midnight. They used to read `(played_at AT TIME ZONE 'UTC')::date
 * >= …`, which is the same set of rows but wraps the column in an expression,
 * so neither `play_events_played_at_idx` nor `listener_samples_sampled_at_idx`
 * could be used: every two-minute tick sequentially scanned the whole of
 * `play_events`, a table that is never pruned. The date conversion is only
 * needed for grouping, which still does it.
 */
export const ROLLUP_TRAFFIC_SQL = `
    WITH days AS (
      SELECT generate_series(
        (now() AT TIME ZONE 'UTC')::date - ($1::int - 1),
        (now() AT TIME ZONE 'UTC')::date,
        interval '1 day'
      )::date AS day
    ), s AS (
      SELECT
        (sampled_at AT TIME ZONE 'UTC')::date AS day,
        max(online)                           AS peak_online,
        max(listening)                        AS peak_listening,
        round(avg(online), 2)                 AS avg_online,
        round(avg(listening), 2)              AS avg_listening,
        count(*)::int                         AS samples
      FROM listener_samples
      WHERE sampled_at >= ((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))::timestamp
                          AT TIME ZONE 'UTC'
      GROUP BY 1
    ), p AS (
      SELECT
        (played_at AT TIME ZONE 'UTC')::date  AS day,
        count(*)                              AS plays,
        count(DISTINCT session_ref)::int      AS sessions
      FROM play_events
      WHERE played_at >= ((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))::timestamp
                         AT TIME ZONE 'UTC'
      GROUP BY 1
    )
    INSERT INTO traffic_daily AS td
      (day, peak_online, peak_listening, avg_online, avg_listening,
       plays, sessions, samples)
    SELECT
      days.day,
      COALESCE(s.peak_online, 0),
      COALESCE(s.peak_listening, 0),
      COALESCE(s.avg_online, 0),
      COALESCE(s.avg_listening, 0),
      COALESCE(p.plays, 0),
      COALESCE(p.sessions, 0),
      COALESCE(s.samples, 0)
    FROM days
    LEFT JOIN s USING (day)
    LEFT JOIN p USING (day)
    -- A day the sampler never observed is not a day with no traffic, and
    -- writing it as zeroes would put a fabricated empty column on the chart
    -- for every day of the rollup window that predates collection. A quiet
    -- day the sampler *did* observe still lands here with samples > 0, which
    -- is the real zero worth keeping.
    WHERE COALESCE(s.samples, 0) > 0 OR COALESCE(p.plays, 0) > 0
    ON CONFLICT (day) DO UPDATE SET
      peak_online    = EXCLUDED.peak_online,
      peak_listening = EXCLUDED.peak_listening,
      avg_online     = EXCLUDED.avg_online,
      avg_listening  = EXCLUDED.avg_listening,
      -- Plays for a past day only ever grow, so taking the larger value is
      -- always right and it carries the changeover: days backfilled from
      -- sample deltas keep their count instead of collapsing to however much
      -- of that day the event log happened to catch.
      plays          = GREATEST(td.plays, EXCLUDED.plays),
      -- Never revise a session count downward. Once session refs expire the
      -- recomputed value would be 0, and a re-rollup of an old day (a manual
      -- backfill, a clock change) must not erase what was counted while the
      -- refs still existed. The rollup window is far shorter than the ref
      -- retention, so in normal operation this never fires.
      sessions       = GREATEST(td.sessions, EXCLUDED.sessions),
      samples        = EXCLUDED.samples
    `;

/**
 * Recompute the daily rollup for the trailing ROLLUP_DAYS.
 *
 * Presence comes from listener_samples (a gauge — peak and mean both mean
 * something); plays and sessions come from play_events, which is an actual
 * event log and so does not need the cumulative-delta arithmetic getTraffic()
 * has to do. Days are UTC, matching the hour-of-day profile.
 */
export async function rollUpTraffic(): Promise<number> {
  const { rowCount } = await pool().query(
    ROLLUP_TRAFFIC_SQL,
    [ROLLUP_DAYS],
  );
  return rowCount ?? 0;
}

/**
 * Strip session references off play events older than the retention window.
 *
 * The event survives; only the link between events in one sitting is dropped.
 * Cheap after the first pass — the partial index means this only ever scans
 * rows that still carry a ref.
 */
export async function anonymizeOldSessions(): Promise<number> {
  const { rowCount } = await pool().query(
    `
    UPDATE play_events SET session_ref = NULL
    WHERE session_ref IS NOT NULL
      AND played_at < now() - ($1::int * interval '1 day')
    `,
    [SESSION_REF_RETENTION_DAYS],
  );
  return rowCount ?? 0;
}

export type TrafficRange = "24h" | "7d" | "30d";

export interface TrafficPoint {
  /** Bucket start, ISO 8601. */
  t: string;
  online: number;
  listening: number;
  /** Plays that happened during this bucket. */
  plays: number;
}

export interface Traffic {
  range: TrafficRange;
  points: TrafficPoint[];
  peakOnline: number;
  peakListening: number;
  playsInRange: number;
  totalPlays: number;
  /** Bucket start of the busiest point, ISO 8601. Null when there is no data. */
  peakAt: string | null;
  /** 24-hour activity profile, always over the last 30 days regardless of range. */
  hourly: HourBucket[];
  /**
   * Plays in the range by the host they came from, from the event log:
   * `{archive, mirror, cache, local, unknown}`. `unknown` is rows written before
   * sources were recorded. What highdesert-status reads for "mirror plays, 24h".
   */
  playsBySource: Record<string, number>;
}

const RANGE_CONFIG: Record<TrafficRange, { hours: number; bucketMinutes: number }> = {
  "24h": { hours: 24, bucketMinutes: 15 },
  "7d": { hours: 24 * 7, bucketMinutes: 120 },
  "30d": { hours: 24 * 30, bucketMinutes: 360 },
};

/**
 * Bucketed traffic over the requested window.
 *
 * Presence is averaged within a bucket (it is a gauge — a level, not a count),
 * while plays are a counter, so they are derived from the difference between
 * the first and last cumulative total in each bucket.
 */
export async function getTraffic(range: TrafficRange): Promise<Traffic> {
  const { hours, bucketMinutes } = RANGE_CONFIG[range];
  const since = new Date(Date.now() - hours * 3_600_000);

  const { rows } = await pool().query<{
    bucket: Date;
    online: string;
    listening: string;
    first_total: string;
    last_total: string;
  }>(
    `
    SELECT
      to_timestamp(
        floor(extract(epoch FROM sampled_at) / ($2 * 60)) * ($2 * 60)
      ) AS bucket,
      round(avg(online))::int    AS online,
      round(avg(listening))::int AS listening,
      min(total_plays)           AS first_total,
      max(total_plays)           AS last_total
    FROM listener_samples
    WHERE sampled_at >= $1
    GROUP BY bucket
    ORDER BY bucket
    `,
    [since, bucketMinutes],
  );

  const points: TrafficPoint[] = rows.map((r, i) => ({
    t: new Date(r.bucket).toISOString(),
    online: Number(r.online),
    listening: Number(r.listening),
    // Plays are cumulative, so a bucket's own plays are its rise. Compare
    // against the previous bucket's close, not its own open, or every play
    // that lands between two buckets is dropped.
    plays: Math.max(
      0,
      Number(r.last_total) - Number(i > 0 ? rows[i - 1].last_total : r.first_total),
    ),
  }));

  const [{ rows: totalRows }, hourly, { rows: sourceRows }] = await Promise.all([
    pool().query<{ total: string }>(
      `SELECT COALESCE(sum(plays), 0) AS total FROM episode_plays`,
    ),
    getHourlyActivity(),
    pool().query<{ source: string; n: string }>(
      `SELECT COALESCE(source, 'unknown') AS source, count(*) AS n
         FROM play_events WHERE played_at >= $1 GROUP BY 1`,
      [since],
    ),
  ]);

  const peakOnline = points.reduce((m, p) => Math.max(m, p.online), 0);

  return {
    range,
    points,
    peakOnline,
    peakListening: points.reduce((m, p) => Math.max(m, p.listening), 0),
    playsInRange: points.reduce((s, p) => s + p.plays, 0),
    totalPlays: Number(totalRows[0]?.total ?? 0),
    // The first bucket that hit the peak, so "busiest at 3:15 AM" names a real
    // moment rather than the last time the level happened to be matched.
    peakAt: peakOnline > 0 ? (points.find((p) => p.online === peakOnline)?.t ?? null) : null,
    hourly,
    playsBySource: Object.fromEntries(sourceRows.map((r) => [r.source, Number(r.n)])),
  };
}
