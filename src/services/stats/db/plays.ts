/**
 * Plays: the per-episode counter, the weekly leaderboard, the recent-plays
 * ticker and the permanent `play_events` log — all written by recordPlay in
 * one statement.
 */

import { pool } from "./pool";
import { ADMIT_SESSION, SESSIONS_PER_CLIENT, clientRef, withClientLock } from "./presence";

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

const WEEKLY_RETENTION_WEEKS = 3;

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Where a listen's audio came from (src/audio/sources.ts). Recorded on every
 * play and failure so the archive.org outage fallback can be seen working — or
 * not. NULL on rows from before it existed, and from clients that do not send
 * it: unknown, not "archive".
 */
export const PLAY_SOURCES = ["archive", "mirror", "cache", "local"] as const;
export type PlaySource = (typeof PLAY_SOURCES)[number];

export function isPlaySource(v: unknown): v is PlaySource {
  return typeof v === "string" && (PLAY_SOURCES as readonly string[]).includes(v);
}

/**
 * Record a play event: bump the episode counter, both leaderboards, and mark
 * the session active. Single statement, so it is atomic.
 */
export async function recordPlay(
  episodeId: string,
  sessionId: string,
  client: string,
  source: PlaySource | null = null,
): Promise<void> {
  // The play itself is always counted (it is already rate-limited per client
  // and allowlisted per episode); only its *presence* is subject to the
  // per-client session cap, exactly as a heartbeat's is.
  const ref = clientRef(client);
  await withClientLock(ref, (c) => c.query(
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
      INSERT INTO play_events (episode_id, session_ref, source) VALUES ($1, $3, $6)
    )
    INSERT INTO active_sessions (session_id, seen_at, listening_at, episode_id, client_ref)
    SELECT $3, now(), now(), $1, $4
    WHERE ${ADMIT_SESSION("$3", "$4", "$5")}
    ON CONFLICT (session_id)
    DO UPDATE SET seen_at = now(), listening_at = now(), episode_id = $1, client_ref = $4
    `,
    [episodeId, weekKey(), sessionId, ref, SESSIONS_PER_CLIENT, source],
  ));
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

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * Drop weekly leaderboard rows older than the retention window. Returns the
 * number of rows deleted.
 *
 * Called from the sampler's maintenance block. It was defined and never
 * called, so `weekly_plays` — documented as three weeks of retention — grew
 * without bound. Only the current week is ever read; the permanent per-play
 * record is `play_events`.
 */
export async function pruneOldWeeks(now = new Date()): Promise<number> {
  const cutoff = weekKey(
    new Date(now.getTime() - WEEKLY_RETENTION_WEEKS * 7 * 86_400_000),
  );
  const { rowCount } = await pool().query(`DELETE FROM weekly_plays WHERE week < $1`, [cutoff]);
  return rowCount ?? 0;
}
