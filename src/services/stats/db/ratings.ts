/**
 * Community ratings. `rating_votes.voter` is an HMAC, never an address (HD-008).
 */

import { HASHED_VOTER_RE } from "@/lib/utils/client-key";
import { pool } from "./pool";

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

/**
 * `rating_votes.voter` is an HMAC of the client's bucket (`voterId` in
 * @/lib/utils/client-key), never an address (HD-008). Refused here as well as
 * in the route, so no future caller can put a plaintext IP back in the table by
 * passing the wrong variable: the column is kept forever, next to episode ids.
 */
function assertHashedVoter(voter: string): void {
  if (!HASHED_VOTER_RE.test(voter)) {
    throw new Error("rating voter must be an HMAC (64 hex), not a client address");
  }
}

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
  assertHashedVoter(userKey);
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
  assertHashedVoter(userKey);
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

export interface CommunityNumbers {
  plays: number;
  /** Mean community rating, two decimals; 0 when unrated. */
  avg: number;
  /** Ratings behind `avg`. */
  count: number;
}

/**
 * Community plays and ratings for every episode that has either, in one read.
 *
 * The library's "Most played" and "Top rated" sort the whole catalog by these,
 * so they cannot come from the windowed /api/stats/episodes (100 ids, the rows
 * on screen): a sort over numbers only a screenful of rows have is not a sort.
 * ~1,300 rows at most, both tables keyed by episode.
 */
export async function getCommunityCatalog(): Promise<Record<string, CommunityNumbers>> {
  const { rows } = await pool().query<{ episode_id: string; plays: string; sum: string; count: string }>(
    `
    SELECT episode_id,
           COALESCE(p.plays, 0) AS plays,
           COALESCE(r.sum, 0)   AS sum,
           COALESCE(r.count, 0) AS count
    FROM (SELECT episode_id, plays FROM episode_plays WHERE plays > 0) p
    FULL JOIN (SELECT episode_id, sum, count FROM episode_ratings WHERE count > 0) r
      USING (episode_id)
    `,
  );
  const out: Record<string, CommunityNumbers> = {};
  for (const r of rows) {
    const count = Number(r.count);
    out[r.episode_id] = {
      plays: Number(r.plays),
      avg: count > 0 ? Number((Number(r.sum) / count).toFixed(2)) : 0,
      count,
    };
  }
  return out;
}
