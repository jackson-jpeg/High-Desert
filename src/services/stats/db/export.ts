/**
 * Reads for sang3r.com (GET /api/stats/export).
 */

import { pool } from "./pool";

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
