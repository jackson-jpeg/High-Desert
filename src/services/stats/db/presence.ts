/**
 * Presence: who is here, and what is on air. `active_sessions` and the
 * per-client session cap (HD-007) live here; recordPlay (plays.ts) shares the
 * cap's lock and admission test.
 */

import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { hashClientKey } from "@/lib/utils/client-key";
import { pool } from "./pool";

export const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
/**
 * How many distinct sessions one client (an IPv4 address, or an IPv6 /64 — see
 * `clientKey`) may hold in `active_sessions` at once.
 *
 * Presence now counts clients, not sessions (getPresence), so a client's extra
 * sessions no longer inflate "online" by themselves. The cap still bounds how
 * many rows one client can make the table carry, and keeps the history below
 * true: when it was written, sessions were what was counted.
 *
 * A session id is minted client-side per page load, so before this cap anyone
 * could post heartbeats with fresh ids and make "online" and "on air" any
 * number they liked (HD-007). Ten covers a household with a tab per person and
 * a phone each; a school or office behind one NAT with more than that is
 * under-counted, which is the right way round for a number strangers see.
 *
 * Over the cap a new session is *accepted and not counted* rather than refused
 * with 429: the heartbeat client ignores the response either way, so a 429
 * would buy nothing but console noise and a retry for the large-NAT case, and
 * the forger learns nothing useful from a 200. A session that was admitted is
 * always renewed — the cap is on joining, never on staying.
 */
export const SESSIONS_PER_CLIENT = 10;
/**
 * Salt for `active_sessions.client_ref`. Random per process and never written
 * anywhere, so the column cannot be reversed to an address and cannot be joined
 * to `rating_votes.voter` (which uses a persistent secret). Presence rows live
 * for five minutes, so a restart costs at most one window in which a client's
 * old and new refs both count — twice the cap, briefly — and nothing else.
 */
const PRESENCE_SALT = randomBytes(32).toString("hex");

export function clientRef(key: string): string {
  return hashClientKey(key, PRESENCE_SALT);
}

/**
 * Run `fn` holding a transaction-scoped lock on one client's presence ref.
 *
 * The cap is a read-then-insert; two heartbeats from the same client in flight
 * at once would otherwise both see nine sessions and both insert. Serialising
 * per client (not globally) costs nothing for anyone else.
 */
export async function withClientLock<T>(ref: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [ref]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The admission test shared by recordPlay and recordHeartbeat: a session that
 * already exists is always admitted (it is renewing, not joining); a new one
 * only while its client holds fewer than SESSIONS_PER_CLIENT live sessions.
 * `$s` is the session id, `$k` the client ref, `$c` the cap.
 */
export const ADMIT_SESSION = (s: string, k: string, c: string) => `
  EXISTS (SELECT 1 FROM active_sessions WHERE session_id = ${s})
  OR (
    SELECT count(*) FROM active_sessions
    WHERE client_ref = ${k} AND seen_at >= now() - interval '${ACTIVE_WINDOW_MS / 1000} seconds'
  ) < ${c}`;

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Mark a session present. Sent by every open tab on an interval, whether or not
 * anything is playing — this is what makes "online" a real number rather than a
 * synonym for "started playback recently".
 *
 * `episodeId` is passed when that tab is playing something right now, and it
 * renews the listening mark. Without it, `listening_at` was written once by
 * recordPlay and never again, while `onAir` filters on `listening_at >= now() -
 * 5 minutes` — so everyone dropped off the air five minutes after pressing
 * play and stayed off it for the remaining two hours and fifty-five minutes of
 * a Coast to Coast broadcast. "On air" measured who had *started* a show
 * recently, not who was listening to one.
 *
 * Omitting it deliberately leaves `listening_at` alone rather than clearing it:
 * a paused tab is mid-show, and it decays out of the window on its own. Stopping
 * and leaving are explicit, and go through clearListening/removeActiveSession.
 */
export async function recordHeartbeat(
  sessionId: string,
  episodeId: string | null,
  client: string,
  /**
   * This tab is tuned in to the live station (and playing, or in the station
   * ID between shows). Unlike the listening mark, a beat without it *clears*
   * it: leaving the station is a decision, not a pause, and the Live screen's
   * count should drop within one beat of it rather than five minutes.
   */
  live = false,
): Promise<void> {
  const ref = clientRef(client);
  await withClientLock(ref, (c) => c.query(
    `
    INSERT INTO active_sessions (session_id, seen_at, listening_at, episode_id, client_ref, live_at)
    SELECT $1, now(), CASE WHEN $2::text IS NULL THEN NULL ELSE now() END, $2, $3,
           CASE WHEN $5::boolean THEN now() ELSE NULL END
    WHERE ${ADMIT_SESSION("$1", "$3", "$4")}
    ON CONFLICT (session_id) DO UPDATE SET
      seen_at = now(),
      listening_at = CASE
        WHEN $2::text IS NULL THEN active_sessions.listening_at
        ELSE now()
      END,
      episode_id = COALESCE($2, active_sessions.episode_id),
      client_ref = $3,
      live_at = CASE WHEN $5::boolean THEN now() ELSE NULL END
    `,
    [sessionId, episodeId ?? null, ref, SESSIONS_PER_CLIENT, live],
  ));
}

/**
 * Playback stopped, but the visitor is still here. Clears the listening mark
 * and leaves presence intact — deleting the row would have dropped them out of
 * the online count while they were still reading the page.
 */
export async function clearListening(sessionId: string): Promise<void> {
  await pool().query(
    `UPDATE active_sessions SET listening_at = NULL, episode_id = NULL, live_at = NULL WHERE session_id = $1`,
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

export interface Presence {
  /** Distinct clients with a heartbeat inside the active window. */
  online: number;
  /** Of those, the clients with a session that is playing something. */
  listening: number;
  /** Of those, the clients tuned in to the live station. */
  live: number;
}

/**
 * Who a presence row belongs to. `client_ref` is the per-client HMAC; a row
 * written before that column existed falls back to its own session, so it
 * still counts once rather than vanishing or merging with a stranger.
 */
const PRESENCE_WHO = "COALESCE(client_ref, 'session:' || session_id)";

/**
 * Who is here right now — the one computation behind every presence number the
 * site shows. Prunes stale sessions as it counts.
 *
 * Counts **clients, not sessions**. A session is one page load, so counting
 * them made two tabs two people, and a closed tab a second person for up to
 * five minutes: one screen once read 7, 8 and 10 "online" on three surfaces.
 * Listening is a subset of online by construction — the same rows, filtered.
 */
export async function getPresence(
  /**
   * Tests only: count just the sessions whose id starts with this, so a DB
   * test running in parallel cannot move the number. Same statement either way.
   */
  sessionPrefix: string | null = null,
): Promise<Presence> {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const { rows } = await pool().query<{ online: number; listening: number; live: number }>(
    `
    WITH pruned AS (
      DELETE FROM active_sessions WHERE seen_at < $1
    ), here AS (
      SELECT ${PRESENCE_WHO} AS who,
             (listening_at >= $1 AND episode_id IS NOT NULL) AS playing,
             (live_at >= $1) AS tuned
      FROM active_sessions
      WHERE seen_at >= $1
        AND ($2::text IS NULL OR starts_with(session_id, $2))
    )
    SELECT
      count(DISTINCT who)::int                         AS online,
      count(DISTINCT who) FILTER (WHERE playing)::int  AS listening,
      count(DISTINCT who) FILTER (WHERE tuned)::int    AS live
    FROM here
    `,
    [cutoff, sessionPrefix],
  );
  return {
    online: rows[0]?.online ?? 0,
    listening: rows[0]?.listening ?? 0,
    live: rows[0]?.live ?? 0,
  };
}

// ---------------------------------------------------------------------------
// On air
// ---------------------------------------------------------------------------

export interface OnAirEntry {
  episodeId: string;
  /** Distinct clients currently playing this episode. */
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
      SELECT episode_id, count(DISTINCT ${PRESENCE_WHO})::int AS listeners
      FROM active_sessions
      WHERE seen_at >= $1 AND listening_at >= $1 AND episode_id IS NOT NULL
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
