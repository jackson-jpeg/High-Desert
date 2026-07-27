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
