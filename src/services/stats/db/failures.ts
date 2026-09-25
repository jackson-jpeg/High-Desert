/**
 * Playback failures: the writer behind /api/playback-event and the reads behind
 * /api/stats/failures.
 */

import { pool } from "./pool";
import type { PlaySource } from "./plays";

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
  /** Context for advisory rows; null for real failures. */
  detail?: string | null;
  /** The host that failed. */
  source?: PlaySource | null;
}

/**
 * Kinds that are recorded but are not failures, and must never be counted as
 * one. Kept next to the writer so a new advisory kind cannot be added without
 * passing this line.
 */
const ADVISORY_KINDS = ["empty-media-suspected"];

/** Distinct raw details returned per episode, before the public filter. */
const STORED_DETAILS_PER_EPISODE = 20;

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
      (episode_id, kind, retried, recovered, elapsed_ms, ua_class, detail, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      f.episodeId,
      f.kind,
      f.retried,
      f.recovered,
      f.elapsedMs,
      f.uaClass,
      f.detail ?? null,
      f.source ?? null,
    ],
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
  /**
   * The most recent distinct things the browser said, newest first, capped —
   * **raw, as posted**. Anyone can post one; never serve these without
   * `publicDetails()` (src/services/stats/failure-detail.ts, HD-038).
   *
   * `MediaError.code` plus its message on a decode or network failure. Chromium
   * writes a real diagnostic ("DEMUXER_ERROR_COULD_NOT_OPEN: …") and it is the
   * only signal that separates an empty file from an unreachable one on that
   * engine. It was already being stored and was only readable by hand — which
   * is the same condition that let 33 phantom rows sit unexamined for four
   * months.
   */
  details: string[];
  /**
   * Failures where the retry was skipped because there was no user activation
   * to call `play()` with — the listener got the dialog instead of a silent
   * teardown.
   *
   * `empty-media` is excluded: it is never retried by design, so counting it
   * here would swamp the number this exists to measure.
   */
  skippedRetries: number;
}

/**
 * Site-wide totals for the same window, so the shape of failure is readable
 * without ranking episodes.
 */
export interface FailureSummary {
  failures: number;
  recovered: number;
  /** See FailureRate.skippedRetries. The instrument for the activation gate. */
  skippedRetries: number;
  /** Failures where the retry ran and did not help. */
  retriedAndFailed: number;
  episodes: number;
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
    skipped_retries: string;
    details: string[] | null;
  }>(
    `
    WITH f AS (
      SELECT episode_id,
             count(*)                                    AS failures,
             count(*) FILTER (WHERE recovered)           AS recovered,
             -- A retry that was skipped for want of a user gesture. empty-media
             -- is never retried by design and would swamp the count.
             count(*) FILTER (
               WHERE NOT retried AND kind <> 'empty-media'
             )                                           AS skipped_retries,
             jsonb_object_agg(kind, n)                   AS kinds,
             max(at)                                     AS last_at
      FROM (
        SELECT episode_id, kind, recovered, retried, at,
               count(*) OVER (PARTITION BY episode_id, kind) AS n
        FROM playback_failures
        WHERE at > now() - ($1 || ' days')::interval
          AND NOT (kind = ANY($3))
      ) s
      GROUP BY episode_id
    ), d AS (
      -- Most recent distinct diagnostics per episode. DISTINCT ON collapses
      -- the usual case of one message repeated fifty times; the LIMIT inside
      -- the aggregate keeps a chatty episode from dominating the payload.
      SELECT episode_id, array_agg(detail ORDER BY at DESC) AS details
      FROM (
        SELECT DISTINCT ON (episode_id, detail) episode_id, detail, at
        FROM playback_failures
        WHERE at > now() - ($1 || ' days')::interval
          AND NOT (kind = ANY($3))
          AND detail IS NOT NULL
        ORDER BY episode_id, detail, at DESC
      ) x
      GROUP BY episode_id
    ), u AS (
      SELECT episode_id, jsonb_object_agg(ua_class, n) AS ua_classes
      FROM (
        SELECT episode_id, ua_class, count(*) AS n
        FROM playback_failures
        WHERE at > now() - ($1 || ' days')::interval
          AND NOT (kind = ANY($3))
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
           f.skipped_retries,
           COALESCE(p.plays, 0) AS plays,
           f.kinds,
           COALESCE(u.ua_classes, '{}'::jsonb) AS ua_classes,
           COALESCE(d.details, ARRAY[]::text[]) AS details,
           f.last_at
    FROM f
    LEFT JOIN p ON p.episode_id = f.episode_id
    LEFT JOIN u ON u.episode_id = f.episode_id
    LEFT JOIN d ON d.episode_id = f.episode_id
    ORDER BY f.failures DESC, f.last_at DESC
    LIMIT $2
    `,
    // Advisory rows are excluded here rather than filtered in the route: this
    // view ranks episodes by how badly they are failing, and a row that did not
    // stop playback would inflate that ranking with something nobody noticed.
    [String(days), limit, ADVISORY_KINDS],
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
      // Raw and deliberately more than the route shows: /api/stats/failures
      // filters these to browser-diagnostic shapes (failure-detail.ts) and
      // then shows three, so junk rows must not have already taken the slots.
      details: (r.details ?? []).slice(0, STORED_DETAILS_PER_EPISODE),
      skippedRetries: Number(r.skipped_retries),
    };
  });
}

/** Failed starts against plays over one fixed window — see `getFailureWindow`. */
export interface FailureWindow {
  from: string;
  to: string;
  failures: number;
  plays: number;
}

/**
 * Failed starts and plays over `[from, to)`, for measuring a release against
 * the week before it (`docs/reliability-baseline.md`). A trailing window cannot
 * do that: seven days after a deploy it still holds the old build's failures,
 * and seven days later it has forgotten the release happened.
 *
 * Failures exclude advisory kinds, exactly as `getFailureSummary` does, and
 * plays are `play_events` — the same count `/api/stats/traffic` reports as
 * `playsInRange`, which is what the baseline was measured with.
 */
export async function getFailureWindow(from: Date, to: Date): Promise<FailureWindow> {
  const { rows } = await pool().query<{ failures: string; plays: string }>(
    `
    SELECT (SELECT count(*) FROM playback_failures
             WHERE at >= $1 AND at < $2
               AND NOT (kind = ANY($3)))                AS failures,
           (SELECT count(*) FROM play_events
             WHERE played_at >= $1 AND played_at < $2)  AS plays
    `,
    [from.toISOString(), to.toISOString(), ADVISORY_KINDS],
  );
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    failures: Number(rows[0]?.failures ?? 0),
    plays: Number(rows[0]?.plays ?? 0),
  };
}

/**
 * Site-wide failure totals for a window.
 *
 * Separate from `getFailureRates` because it must not be a sum of that: the
 * ranked view is capped at 50 episodes, so summing it would silently
 * under-report the moment there are 51. Same advisory exclusion, so the two
 * agree about what counts as a failure.
 */
export async function getFailureSummary(days: number): Promise<FailureSummary> {
  const { rows } = await pool().query<{
    failures: string;
    recovered: string;
    skipped_retries: string;
    retried_and_failed: string;
    episodes: string;
  }>(
    `
    SELECT count(*)                                          AS failures,
           count(*) FILTER (WHERE recovered)                 AS recovered,
           count(*) FILTER (
             WHERE NOT retried AND kind <> 'empty-media'
           )                                                 AS skipped_retries,
           count(*) FILTER (WHERE retried AND NOT recovered) AS retried_and_failed,
           count(DISTINCT episode_id)                        AS episodes
    FROM playback_failures
    WHERE at > now() - ($1 || ' days')::interval
      AND NOT (kind = ANY($2))
    `,
    [String(days), ADVISORY_KINDS],
  );

  const r = rows[0];
  return {
    failures: Number(r?.failures ?? 0),
    recovered: Number(r?.recovered ?? 0),
    skippedRetries: Number(r?.skipped_retries ?? 0),
    retriedAndFailed: Number(r?.retried_and_failed ?? 0),
    episodes: Number(r?.episodes ?? 0),
  };
}
