/**
 * Server-side KV service layer for community stats.
 *
 * Wraps all Vercel KV (Upstash Redis) operations behind a functional API.
 * API routes import from here — they never import `@vercel/kv` directly.
 *
 * Key schema:
 *   ep:{episodeId}          — counter (total plays per episode)
 *   lb:alltime              — sorted set (episodeId → cumulative plays)
 *   lb:week:YYYY-WNN        — sorted set (episodeId → plays this ISO week)
 *   active                  — sorted set (sessionId → timestamp)
 *   rt:{episodeId}          — hash { sum: number, count: number, avg: number }
 *   rt:user:{ip}:{epId}     — string (previous rating by this IP, for idempotent updates)
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the Redis key for the current ISO week, e.g. `lb:week:2026-W10`. */
export function weekKey(now = new Date()): string {
  // ISO week calculation: find the Thursday of the current week,
  // then derive the ISO year and week number from that.
  const d = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  // Set to nearest Thursday: current date + 4 - current day number (Mon=1..Sun=7)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `lb:week:${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

const WEEKLY_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Record a play event. Atomically increments per-episode counter,
 * updates both leaderboards, and marks the session as active.
 */
export async function recordPlay(
  episodeId: string,
  sessionId: string,
): Promise<void> {
  const wk = weekKey();
  const now = Date.now();

  const pipe = kv.pipeline();
  pipe.incr(`ep:${episodeId}`);
  pipe.zincrby("lb:alltime", 1, episodeId);
  pipe.zincrby(wk, 1, episodeId);
  pipe.zadd("active", { score: now, member: sessionId });
  pipe.expire(wk, WEEKLY_TTL_SECONDS);

  await pipe.exec();
}

/** Remove a session from the active-listeners set. */
export async function removeActiveSession(sessionId: string): Promise<void> {
  await kv.zrem("active", sessionId);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Bulk-fetch play counts for a list of episode IDs.
 * Returns only entries with count > 0.
 */
export async function getEpisodeCounts(
  ids: string[],
): Promise<Record<string, number>> {
  if (ids.length === 0) return {};

  const keys = ids.map((id) => `ep:${id}`);
  const values = await kv.mget<(number | null)[]>(...keys);

  const result: Record<string, number> = {};
  for (let i = 0; i < ids.length; i++) {
    const v = values[i];
    if (v != null && v > 0) {
      result[ids[i]] = v;
    }
  }
  return result;
}

/**
 * Retrieve the top episodes by play count for a given period.
 */
export async function getLeaderboard(
  period: "alltime" | "week",
  limit = 20,
): Promise<{ episodeId: string; plays: number }[]> {
  const key = period === "alltime" ? "lb:alltime" : weekKey();

  const raw = await kv.zrange<string[]>(key, 0, limit - 1, {
    rev: true,
    withScores: true,
  });

  // zrange with withScores returns [member, score, member, score, ...]
  const entries: { episodeId: string; plays: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({
      episodeId: String(raw[i]),
      plays: Number(raw[i + 1]),
    });
  }
  return entries;
}

/**
 * Count currently active listeners. Prunes sessions older than 5 minutes
 * before counting.
 */
export async function getActiveCount(): Promise<number> {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  await kv.zremrangebyscore("active", 0, cutoff);
  return kv.zcard("active");
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

const RATING_USER_TTL = 365 * 24 * 60 * 60; // 1 year

/**
 * Record or update a user's rating for an episode.
 * Idempotent per IP — re-rating adjusts the aggregate rather than double-counting.
 */
export async function recordRating(
  episodeId: string,
  rating: number,
  userKey: string,
): Promise<void> {
  const ratingKey = `rt:${episodeId}`;
  const userRatingKey = `rt:user:${userKey}:${episodeId}`;

  // Check if user already rated this episode
  const previousRating = await kv.get<number>(userRatingKey);

  const pipe = kv.pipeline();

  if (previousRating != null) {
    // Update: subtract old rating, add new one
    pipe.hincrbyfloat(ratingKey, "sum", rating - previousRating);
  } else {
    // New rating
    pipe.hincrbyfloat(ratingKey, "sum", rating);
    pipe.hincrby(ratingKey, "count", 1);
  }

  // Store user's rating for idempotency
  pipe.set(userRatingKey, rating, { ex: RATING_USER_TTL });

  await pipe.exec();

  // Update cached average
  const data = await kv.hmget<{ sum: string; count: string }>(ratingKey, "sum", "count");
  const sum = Number(data?.sum ?? 0);
  const count = Number(data?.count ?? 0);
  if (count > 0) {
    await kv.hset(ratingKey, { avg: (sum / count).toFixed(2) });
  }
}

/**
 * Remove a user's rating for an episode.
 */
export async function removeRating(
  episodeId: string,
  userKey: string,
): Promise<void> {
  const ratingKey = `rt:${episodeId}`;
  const userRatingKey = `rt:user:${userKey}:${episodeId}`;

  const previousRating = await kv.get<number>(userRatingKey);
  if (previousRating == null) return;

  const pipe = kv.pipeline();
  pipe.hincrbyfloat(ratingKey, "sum", -previousRating);
  pipe.hincrby(ratingKey, "count", -1);
  pipe.del(userRatingKey);
  await pipe.exec();

  // Update cached average
  const data = await kv.hmget<{ sum: string; count: string }>(ratingKey, "sum", "count");
  const sum = Number(data?.sum ?? 0);
  const count = Number(data?.count ?? 0);
  if (count > 0) {
    await kv.hset(ratingKey, { avg: (sum / count).toFixed(2) });
  } else {
    await kv.hset(ratingKey, { avg: "0" });
  }
}

/**
 * Bulk-fetch community ratings for a list of episode IDs.
 * Returns { avg, count } for each episode that has ratings.
 */
export async function getRatings(
  ids: string[],
): Promise<Record<string, { avg: number; count: number }>> {
  if (ids.length === 0) return {};

  const result: Record<string, { avg: number; count: number }> = {};

  // Fetch in parallel
  const promises = ids.map(async (id) => {
    const data = await kv.hmget<{ avg: string; count: string }>(`rt:${id}`, "avg", "count");
    if (data?.count && Number(data.count) > 0) {
      result[id] = {
        avg: Number(data.avg ?? 0),
        count: Number(data.count),
      };
    }
  });

  await Promise.all(promises);
  return result;
}
