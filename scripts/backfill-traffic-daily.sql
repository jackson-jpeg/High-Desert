-- One-time backfill of traffic_daily from the existing sample window.
--
-- traffic_daily is written going forward by rollUpTraffic(), which recomputes
-- only the last few days. Without this, the permanent history would begin on
-- the day it was deployed while listener_samples still held up to 90 days of
-- real traffic that was about to age out and be lost for good.
--
-- Plays are derived from the cumulative total_plays column the same way
-- getTraffic() does it — the difference between consecutive samples — because
-- play_events did not exist yet and there is no other record of when a play
-- happened. That makes these counts approximate at the day boundary (a play
-- between the last sample of one day and the first of the next lands on the
-- later day) and blind to anything before sampling started. Days the sampler
-- never observed are absent rather than zero.
--
-- Sessions are left at 0: session references only exist in play_events, so for
-- these days the honest answer is "not recorded", and rollUpTraffic()'s
-- GREATEST() guard means a later pass will never overwrite a real count with
-- this placeholder.
--
-- Safe to re-run: idempotent per day, and it never lowers an existing figure.
--
-- Apply with:  psql "$DATABASE_URL" -f scripts/backfill-traffic-daily.sql

WITH deltas AS (
  SELECT
    (sampled_at AT TIME ZONE 'UTC')::date AS day,
    online,
    listening,
    GREATEST(
      0,
      total_plays - lag(total_plays) OVER (ORDER BY sampled_at)
    ) AS plays
  FROM listener_samples
), rolled AS (
  SELECT
    day,
    max(online)::int          AS peak_online,
    max(listening)::int       AS peak_listening,
    round(avg(online), 2)     AS avg_online,
    round(avg(listening), 2)  AS avg_listening,
    COALESCE(sum(plays), 0)   AS plays,
    count(*)::int             AS samples
  FROM deltas
  GROUP BY day
)
INSERT INTO traffic_daily AS td
  (day, peak_online, peak_listening, avg_online, avg_listening,
   plays, sessions, samples)
SELECT day, peak_online, peak_listening, avg_online, avg_listening,
       plays, 0, samples
FROM rolled
ON CONFLICT (day) DO UPDATE SET
  peak_online    = GREATEST(td.peak_online,    EXCLUDED.peak_online),
  peak_listening = GREATEST(td.peak_listening, EXCLUDED.peak_listening),
  avg_online     = GREATEST(td.avg_online,     EXCLUDED.avg_online),
  avg_listening  = GREATEST(td.avg_listening,  EXCLUDED.avg_listening),
  plays          = GREATEST(td.plays,          EXCLUDED.plays),
  sessions       = GREATEST(td.sessions,       EXCLUDED.sessions),
  samples        = GREATEST(td.samples,        EXCLUDED.samples);
