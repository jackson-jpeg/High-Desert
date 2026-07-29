/**
 * Server-side store for community stats (Postgres, self-hosted).
 *
 * API routes import from here — they never touch the database driver directly.
 * Replaced the Vercel KV (Upstash Redis) implementation; see scripts/schema.sql
 * for the key-layout mapping.
 *
 * Every function throws if DATABASE_URL is unset or the database is unreachable.
 * Routes catch that and return 503, and the client degrades to empty stats — the
 * app is fully usable without this subsystem.
 */

import { Pool } from "pg";

let _pool: Pool | null = null;

function pool(): Pool {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
  _pool = new Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // A pool-level error (e.g. the server restarting) must not take the process down.
  _pool.on("error", (err) => {
    console.error("[stats/store] idle client error:", err.message);
  });
  return _pool;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO week label for the weekly leaderboard, e.g. `2026-W31`. */
export function weekKey(now = new Date()): string {
  // Find the Thursday of this week, then derive the ISO year and week from it.
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const WEEKLY_RETENTION_WEEKS = 3;
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
// Writes
// ---------------------------------------------------------------------------

/**
 * Record a play event: bump the episode counter, both leaderboards, and mark
 * the session active. Single statement, so it is atomic.
 */
export async function recordPlay(
  episodeId: string,
  sessionId: string,
): Promise<void> {
  await pool().query(
    `
    WITH p AS (
      INSERT INTO episode_plays (episode_id, plays) VALUES ($1, 1)
      ON CONFLICT (episode_id) DO UPDATE SET plays = episode_plays.plays + 1
    ), w AS (
      INSERT INTO weekly_plays (week, episode_id, plays) VALUES ($2, $1, 1)
      ON CONFLICT (week, episode_id) DO UPDATE SET plays = weekly_plays.plays + 1
    ), r AS (
      INSERT INTO recent_plays (episode_id) VALUES ($1)
    ), pruned AS (
      DELETE FROM recent_plays WHERE played_at < now() - interval '24 hours'
    ), ev AS (
      -- The permanent log. Same event as recent_plays, but never pruned and
      -- carrying the session ref until it expires; see scripts/schema.sql.
      INSERT INTO play_events (episode_id, session_ref) VALUES ($1, $3)
    )
    INSERT INTO active_sessions (session_id, seen_at, listening_at, episode_id)
    VALUES ($3, now(), now(), $1)
    ON CONFLICT (session_id)
    DO UPDATE SET seen_at = now(), listening_at = now(), episode_id = $1
    `,
    [episodeId, weekKey(), sessionId],
  );
}

/**
 * Mark a session present. Sent by every open tab on an interval, whether or not
 * anything is playing — this is what makes "online" a real number rather than a
 * synonym for "started playback recently".
 */
export async function recordHeartbeat(sessionId: string): Promise<void> {
  await pool().query(
    `
    INSERT INTO active_sessions (session_id, seen_at) VALUES ($1, now())
    ON CONFLICT (session_id) DO UPDATE SET seen_at = now()
    `,
    [sessionId],
  );
}

/**
 * Playback stopped, but the visitor is still here. Clears the listening mark
 * and leaves presence intact — deleting the row would have dropped them out of
 * the online count while they were still reading the page.
 */
export async function clearListening(sessionId: string): Promise<void> {
  await pool().query(
    `UPDATE active_sessions SET listening_at = NULL, episode_id = NULL WHERE session_id = $1`,
    [sessionId],
  );
}

/** Remove a session outright. Used on page unload. */
export async function removeActiveSession(sessionId: string): Promise<void> {
  await pool().query(`DELETE FROM active_sessions WHERE session_id = $1`, [
    sessionId,
  ]);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Bulk-fetch play counts. Returns only episodes with at least one play. */
export async function getEpisodeCounts(
  ids: string[],
): Promise<Record<string, number>> {
  if (ids.length === 0) return {};

  const { rows } = await pool().query<{ episode_id: string; plays: string }>(
    `SELECT episode_id, plays FROM episode_plays
     WHERE episode_id = ANY($1::text[]) AND plays > 0`,
    [ids],
  );

  const result: Record<string, number> = {};
  for (const r of rows) result[r.episode_id] = Number(r.plays);
  return result;
}

/** Top episodes by play count for the given period. */
export async function getLeaderboard(
  period: "alltime" | "week",
  limit = 20,
): Promise<{ episodeId: string; plays: number }[]> {
  const { rows } =
    period === "alltime"
      ? await pool().query<{ episode_id: string; plays: string }>(
          `SELECT episode_id, plays FROM episode_plays
           WHERE plays > 0 ORDER BY plays DESC, episode_id LIMIT $1`,
          [limit],
        )
      : await pool().query<{ episode_id: string; plays: string }>(
          `SELECT episode_id, plays FROM weekly_plays
           WHERE week = $1 AND plays > 0 ORDER BY plays DESC, episode_id LIMIT $2`,
          [weekKey(), limit],
        );

  return rows.map((r) => ({ episodeId: r.episode_id, plays: Number(r.plays) }));
}

export interface Presence {
  /** Sessions that have sent a heartbeat inside the active window. */
  online: number;
  /** Of those, sessions with a play event inside the window. */
  listening: number;
}

/** Who is here right now. Prunes stale sessions as it counts. */
export async function getPresence(): Promise<Presence> {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const { rows } = await pool().query<{ online: number; listening: number }>(
    `
    WITH pruned AS (
      DELETE FROM active_sessions WHERE seen_at < $1
    )
    SELECT
      count(*)::int                                        AS online,
      count(*) FILTER (WHERE listening_at >= $1)::int      AS listening
    FROM active_sessions
    WHERE seen_at >= $1
    `,
    [cutoff],
  );
  return { online: rows[0]?.online ?? 0, listening: rows[0]?.listening ?? 0 };
}

/** Back-compat: the number the UI has always called "listening now". */
export async function getActiveCount(): Promise<number> {
  return (await getPresence()).listening;
}

// ---------------------------------------------------------------------------
// On air
// ---------------------------------------------------------------------------

export interface OnAirEntry {
  episodeId: string;
  /** Sessions currently playing this episode. */
  listeners: number;
}

export interface RecentPlay {
  episodeId: string;
  /** When it was most recently started, ISO 8601. */
  at: string;
}

export interface NowPlaying extends Presence {
  /** What the community has playing right now, most listeners first. */
  onAir: OnAirEntry[];
  /** What was started recently, newest first. Excludes anything still on air. */
  recent: RecentPlay[];
}

/** How many recently-played episodes to surface. */
const RECENT_LIMIT = 8;

/**
 * Presence plus what is actually playing.
 *
 * Aggregate by construction: the returned rows are episode ids and counts, and
 * no query here reads session_id alongside episode_id. Nothing identifies a
 * visitor, and there is nothing to identify them with — sessions are random
 * ids held in memory for the life of a tab.
 */
export async function getNowPlaying(): Promise<NowPlaying> {
  // Prunes stale sessions, so the two queries below see a clean table.
  const presence = await getPresence();
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);

  const [onAirRes, recentRes] = await Promise.all([
    pool().query<{ episode_id: string; listeners: number }>(
      `
      SELECT episode_id, count(*)::int AS listeners
      FROM active_sessions
      WHERE listening_at >= $1 AND episode_id IS NOT NULL
      GROUP BY episode_id
      ORDER BY listeners DESC, episode_id
      LIMIT 12
      `,
      [cutoff],
    ),
    // DISTINCT ON collapses repeats: restarting or seeking the same episode
    // fires a fresh play event, and without this one visitor replaying one show
    // fills the whole ticker.
    pool().query<{ episode_id: string; at: Date }>(
      `
      SELECT DISTINCT ON (episode_id) episode_id, played_at AS at
      FROM recent_plays
      ORDER BY episode_id, played_at DESC
      `,
    ),
  ]);

  const onAir = onAirRes.rows.map((r) => ({
    episodeId: r.episode_id,
    listeners: Number(r.listeners),
  }));
  const live = new Set(onAir.map((e) => e.episodeId));

  const recent = recentRes.rows
    .filter((r) => !live.has(r.episode_id))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, RECENT_LIMIT)
    .map((r) => ({ episodeId: r.episode_id, at: new Date(r.at).toISOString() }));

  return { ...presence, onAir, recent };
}

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
 * Recompute the daily rollup for the trailing ROLLUP_DAYS.
 *
 * Presence comes from listener_samples (a gauge — peak and mean both mean
 * something); plays and sessions come from play_events, which is an actual
 * event log and so does not need the cumulative-delta arithmetic getTraffic()
 * has to do. Days are UTC, matching the hour-of-day profile.
 */
export async function rollUpTraffic(): Promise<number> {
  const { rowCount } = await pool().query(
    `
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
      WHERE (sampled_at AT TIME ZONE 'UTC')::date
            >= (now() AT TIME ZONE 'UTC')::date - ($1::int - 1)
      GROUP BY 1
    ), p AS (
      SELECT
        (played_at AT TIME ZONE 'UTC')::date  AS day,
        count(*)                              AS plays,
        count(DISTINCT session_ref)::int      AS sessions
      FROM play_events
      WHERE (played_at AT TIME ZONE 'UTC')::date
            >= (now() AT TIME ZONE 'UTC')::date - ($1::int - 1)
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
    `,
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

  const [{ rows: totalRows }, hourly] = await Promise.all([
    pool().query<{ total: string }>(
      `SELECT COALESCE(sum(plays), 0) AS total FROM episode_plays`,
    ),
    getHourlyActivity(),
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
  };
}

// ---------------------------------------------------------------------------
// Export — reads for sang3r.com
//
// Everything below is read-only and serves GET /api/stats/export. It is the
// only consumer of the permanent tables; the public /api/stats/* routes still
// read the live ones, so the site is unaffected by anything here.
// ---------------------------------------------------------------------------

export interface PlayEvent {
  /** Monotonic id — use as the pagination cursor, not the timestamp. */
  id: number;
  episodeId: string;
  /** ISO 8601. */
  at: string;
  /** Null once the reference has expired, or if the play predates the log. */
  session: string | null;
}

/**
 * A page of the permanent play log, oldest first.
 *
 * Ordered and paged by id rather than played_at: two plays can share a
 * timestamp, and a timestamp cursor would either skip or repeat them.
 */
export async function getPlayEvents(opts: {
  since?: Date;
  until?: Date;
  /** Return events with id strictly greater than this. */
  afterId?: number;
  limit: number;
}): Promise<PlayEvent[]> {
  const { rows } = await pool().query<{
    id: string;
    episode_id: string;
    played_at: Date;
    session_ref: string | null;
  }>(
    `
    SELECT id, episode_id, played_at, session_ref
    FROM play_events
    WHERE ($1::timestamptz IS NULL OR played_at >= $1)
      AND ($2::timestamptz IS NULL OR played_at <  $2)
      AND ($3::bigint      IS NULL OR id        >  $3)
    ORDER BY id
    LIMIT $4
    `,
    [opts.since ?? null, opts.until ?? null, opts.afterId ?? null, opts.limit],
  );

  return rows.map((r) => ({
    id: Number(r.id),
    episodeId: r.episode_id,
    at: new Date(r.played_at).toISOString(),
    session: r.session_ref,
  }));
}

export interface DailyTraffic {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  peakOnline: number;
  peakListening: number;
  avgOnline: number;
  avgListening: number;
  plays: number;
  /** Distinct listening sessions, as counted while refs were still live. */
  sessions: number;
  /**
   * Traffic samples the presence figures were built from. Zero means the day
   * was never sampled — not that nobody came. The same distinction the hourly
   * profile makes.
   */
  samples: number;
}

/** The permanent daily history, oldest first. */
export async function getDailyTraffic(days: number): Promise<DailyTraffic[]> {
  const { rows } = await pool().query<{
    day: Date;
    peak_online: number;
    peak_listening: number;
    avg_online: string;
    avg_listening: string;
    plays: string;
    sessions: number;
    samples: number;
  }>(
    `
    SELECT day, peak_online, peak_listening, avg_online, avg_listening,
           plays, sessions, samples
    FROM traffic_daily
    WHERE day >= (now() AT TIME ZONE 'UTC')::date - ($1::int - 1)
    ORDER BY day
    `,
    [days],
  );

  return rows.map((r) => ({
    // `day` is a DATE; node-postgres hands it back as a local-midnight Date, so
    // toISOString() can roll it to the previous day west of UTC. Format the
    // local fields instead — they are the ones that carry the right calendar day.
    day: `${r.day.getFullYear()}-${String(r.day.getMonth() + 1).padStart(2, "0")}-${String(r.day.getDate()).padStart(2, "0")}`,
    peakOnline: r.peak_online,
    peakListening: r.peak_listening,
    avgOnline: Number(r.avg_online),
    avgListening: Number(r.avg_listening),
    plays: Number(r.plays),
    sessions: r.sessions,
    samples: r.samples,
  }));
}

export interface ExportSummary {
  /** Total plays ever, from the counter — authoritative, predates the log. */
  totalPlays: number;
  /** Rows in the permanent log. Lower than totalPlays for plays before it existed. */
  loggedPlays: number;
  /** Distinct episodes that have ever been played. */
  episodesPlayed: number;
  /** Oldest and newest logged event, ISO 8601. Null on an empty log. */
  firstPlayAt: string | null;
  lastPlayAt: string | null;
  /** Highest id in the log — the cursor a full sync should resume from. */
  lastEventId: number;
  playsLast24h: number;
  playsLast7d: number;
  playsLast30d: number;
  /** Distinct listening sessions in the last 24h / 7d, while refs are live. */
  sessionsLast24h: number;
  sessionsLast7d: number;
  daysRecorded: number;
  ratingsSubmitted: number;
}

/** One-shot headline figures for the dashboard. */
export async function getExportSummary(): Promise<ExportSummary> {
  const { rows } = await pool().query<Record<string, string | null>>(
    `
    SELECT
      (SELECT COALESCE(sum(plays), 0) FROM episode_plays)                AS total_plays,
      (SELECT count(*) FROM play_events)                                 AS logged_plays,
      (SELECT count(*) FROM episode_plays WHERE plays > 0)               AS episodes_played,
      (SELECT min(played_at)::text FROM play_events)                     AS first_play_at,
      (SELECT max(played_at)::text FROM play_events)                     AS last_play_at,
      (SELECT COALESCE(max(id), 0) FROM play_events)                     AS last_event_id,
      (SELECT count(*) FROM play_events
        WHERE played_at >= now() - interval '24 hours')                  AS plays_24h,
      (SELECT count(*) FROM play_events
        WHERE played_at >= now() - interval '7 days')                    AS plays_7d,
      (SELECT count(*) FROM play_events
        WHERE played_at >= now() - interval '30 days')                   AS plays_30d,
      (SELECT count(DISTINCT session_ref) FROM play_events
        WHERE played_at >= now() - interval '24 hours')                  AS sessions_24h,
      (SELECT count(DISTINCT session_ref) FROM play_events
        WHERE played_at >= now() - interval '7 days')                    AS sessions_7d,
      (SELECT count(*) FROM traffic_daily WHERE samples > 0)             AS days_recorded,
      (SELECT COALESCE(sum(count), 0) FROM episode_ratings)              AS ratings
    `,
  );

  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  const iso = (k: string) => (r[k] ? new Date(r[k] as string).toISOString() : null);

  return {
    totalPlays: n("total_plays"),
    loggedPlays: n("logged_plays"),
    episodesPlayed: n("episodes_played"),
    firstPlayAt: iso("first_play_at"),
    lastPlayAt: iso("last_play_at"),
    lastEventId: n("last_event_id"),
    playsLast24h: n("plays_24h"),
    playsLast7d: n("plays_7d"),
    playsLast30d: n("plays_30d"),
    sessionsLast24h: n("sessions_24h"),
    sessionsLast7d: n("sessions_7d"),
    daysRecorded: n("days_recorded"),
    ratingsSubmitted: n("ratings"),
  };
}

export interface EpisodeStat {
  episodeId: string;
  plays: number;
  /** Community rating, null when nobody has voted. */
  rating: number | null;
  ratingCount: number;
  /** Most recent logged play, ISO 8601. Null if it predates the log. */
  lastPlayedAt: string | null;
}

/** Per-episode totals, most played first. Joins the counter to ratings. */
export async function getEpisodeStats(limit: number): Promise<EpisodeStat[]> {
  const { rows } = await pool().query<{
    episode_id: string;
    plays: string;
    sum: string | null;
    count: string | null;
    last_played_at: Date | null;
  }>(
    `
    SELECT
      p.episode_id,
      p.plays,
      r.sum,
      r.count,
      (SELECT max(played_at) FROM play_events e
        WHERE e.episode_id = p.episode_id) AS last_played_at
    FROM episode_plays p
    LEFT JOIN episode_ratings r ON r.episode_id = p.episode_id
    WHERE p.plays > 0
    ORDER BY p.plays DESC, p.episode_id
    LIMIT $1
    `,
    [limit],
  );

  return rows.map((r) => {
    const count = Number(r.count ?? 0);
    return {
      episodeId: r.episode_id,
      plays: Number(r.plays),
      rating: count > 0 ? Number((Number(r.sum) / count).toFixed(2)) : null,
      ratingCount: count,
      lastPlayedAt: r.last_played_at
        ? new Date(r.last_played_at).toISOString()
        : null,
    };
  });
}

/** Drop weekly leaderboard rows older than the retention window. */
export async function pruneOldWeeks(): Promise<void> {
  const cutoff = weekKey(
    new Date(Date.now() - WEEKLY_RETENTION_WEEKS * 7 * 86_400_000),
  );
  await pool().query(`DELETE FROM weekly_plays WHERE week < $1`, [cutoff]);
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

/**
 * Record or update a rating. Idempotent per voter: re-rating adjusts the
 * aggregate by the delta rather than double-counting.
 *
 * The CTE reads the previous vote from the statement's snapshot, before the
 * upsert writes, so the whole read-modify-write is atomic. The old Redis
 * implementation did this in three round-trips and could interleave.
 */
export async function recordRating(
  episodeId: string,
  rating: number,
  userKey: string,
): Promise<void> {
  await pool().query(
    `
    WITH prev AS (
      SELECT rating FROM rating_votes WHERE voter = $3 AND episode_id = $1
    ), up AS (
      INSERT INTO rating_votes (voter, episode_id, rating) VALUES ($3, $1, $2)
      ON CONFLICT (voter, episode_id)
      DO UPDATE SET rating = EXCLUDED.rating, updated_at = now()
    )
    INSERT INTO episode_ratings (episode_id, sum, count) VALUES ($1, $2, 1)
    ON CONFLICT (episode_id) DO UPDATE SET
      sum   = episode_ratings.sum   + $2 - COALESCE((SELECT rating FROM prev), 0),
      count = episode_ratings.count + CASE WHEN (SELECT rating FROM prev) IS NULL THEN 1 ELSE 0 END
    `,
    [episodeId, rating, userKey],
  );
}

/** Remove a voter's rating and back it out of the aggregate. */
export async function removeRating(
  episodeId: string,
  userKey: string,
): Promise<void> {
  await pool().query(
    `
    WITH prev AS (
      SELECT rating FROM rating_votes WHERE voter = $2 AND episode_id = $1
    ), del AS (
      DELETE FROM rating_votes WHERE voter = $2 AND episode_id = $1
    )
    UPDATE episode_ratings SET
      sum   = GREATEST(0, episode_ratings.sum   - COALESCE((SELECT rating FROM prev), 0)),
      count = GREATEST(0, episode_ratings.count - CASE WHEN (SELECT rating FROM prev) IS NULL THEN 0 ELSE 1 END)
    WHERE episode_id = $1 AND (SELECT rating FROM prev) IS NOT NULL
    `,
    [episodeId, userKey],
  );
}

/** Bulk-fetch community ratings. Returns only episodes with at least one vote. */
export async function getRatings(
  ids: string[],
): Promise<Record<string, { avg: number; count: number }>> {
  if (ids.length === 0) return {};

  const { rows } = await pool().query<{
    episode_id: string;
    sum: string;
    count: string;
  }>(
    `SELECT episode_id, sum, count FROM episode_ratings
     WHERE episode_id = ANY($1::text[]) AND count > 0`,
    [ids],
  );

  const result: Record<string, { avg: number; count: number }> = {};
  for (const r of rows) {
    const count = Number(r.count);
    result[r.episode_id] = {
      avg: Number((Number(r.sum) / count).toFixed(2)),
      count,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Playback failures
// ---------------------------------------------------------------------------

export interface PlaybackFailureInput {
  episodeId: string;
  kind: string;
  retried: boolean;
  recovered: boolean;
  elapsedMs: number;
  uaClass: string;
}

/**
 * Record a playback failure and prune anything older than 90 days, in one
 * statement — the same shape as recordPlay's rolling prune of recent_plays.
 * Nothing else writes this table, so there is no other place the prune could
 * reliably live.
 */
export async function recordPlaybackFailure(
  f: PlaybackFailureInput,
): Promise<void> {
  await pool().query(
    `
    WITH pruned AS (
      DELETE FROM playback_failures WHERE at < now() - interval '90 days'
    )
    INSERT INTO playback_failures
      (episode_id, kind, retried, recovered, elapsed_ms, ua_class)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [f.episodeId, f.kind, f.retried, f.recovered, f.elapsedMs, f.uaClass],
  );
}

export interface FailureRate {
  episodeId: string;
  failures: number;
  /** Failures the retry rescued — the listener saw nothing, but it is flaky. */
  recovered: number;
  plays: number;
  /** failures / (plays + failures), 0–1. Null when there is nothing to divide. */
  rate: number | null;
  kinds: Record<string, number>;
  uaClasses: Record<string, number>;
  lastAt: string;
}

/**
 * Worst episodes over a window, ranked by failure count.
 *
 * Joined against play_events rather than episode_plays so the play total covers
 * the same window as the failures — episode_plays is an all-time counter, and
 * dividing recent failures by lifetime plays would flatter every old episode.
 */
export async function getFailureRates(
  days: number,
  limit = 50,
): Promise<FailureRate[]> {
  const { rows } = await pool().query<{
    episode_id: string;
    failures: string;
    recovered: string;
    plays: string;
    kinds: Record<string, number>;
    ua_classes: Record<string, number>;
    last_at: Date;
  }>(
    `
    WITH f AS (
      SELECT episode_id,
             count(*)                                    AS failures,
             count(*) FILTER (WHERE recovered)           AS recovered,
             jsonb_object_agg(kind, n)                   AS kinds,
             max(at)                                     AS last_at
      FROM (
        SELECT episode_id, kind, recovered, at,
               count(*) OVER (PARTITION BY episode_id, kind) AS n
        FROM playback_failures
        WHERE at > now() - ($1 || ' days')::interval
      ) s
      GROUP BY episode_id
    ), u AS (
      SELECT episode_id, jsonb_object_agg(ua_class, n) AS ua_classes
      FROM (
        SELECT episode_id, ua_class, count(*) AS n
        FROM playback_failures
        WHERE at > now() - ($1 || ' days')::interval
        GROUP BY episode_id, ua_class
      ) t
      GROUP BY episode_id
    ), p AS (
      SELECT episode_id, count(*) AS plays
      FROM play_events
      WHERE played_at > now() - ($1 || ' days')::interval
      GROUP BY episode_id
    )
    SELECT f.episode_id,
           f.failures,
           f.recovered,
           COALESCE(p.plays, 0) AS plays,
           f.kinds,
           COALESCE(u.ua_classes, '{}'::jsonb) AS ua_classes,
           f.last_at
    FROM f
    LEFT JOIN p ON p.episode_id = f.episode_id
    LEFT JOIN u ON u.episode_id = f.episode_id
    ORDER BY f.failures DESC, f.last_at DESC
    LIMIT $2
    `,
    [String(days), limit],
  );

  return rows.map((r) => {
    const failures = Number(r.failures);
    const plays = Number(r.plays);
    const attempts = plays + failures;
    return {
      episodeId: r.episode_id,
      failures,
      recovered: Number(r.recovered),
      plays,
      rate: attempts > 0 ? Number((failures / attempts).toFixed(3)) : null,
      kinds: r.kinds ?? {},
      uaClasses: r.ua_classes ?? {},
      lastAt: r.last_at.toISOString(),
    };
  });
}
