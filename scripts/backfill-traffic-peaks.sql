-- Fill traffic_daily.peak_at for days rolled up before the column existed,
-- from the raw listener_samples that still cover them (kept 90 days).
--
-- Idempotent and safe to re-run: it only writes a day whose raw maximum still
-- equals the stored peak_online, so a day whose samples have been partly
-- pruned (the oldest one) is left NULL rather than given the time of some
-- lesser sample. Days the rollup has written since the column was added
-- already carry peak_at; they are skipped unless it disagrees with the raw
-- data, which the rollup's own definition makes impossible.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/backfill-traffic-peaks.sql
UPDATE traffic_daily td
SET peak_at = s.peak_at
FROM (
  SELECT
    (sampled_at AT TIME ZONE 'UTC')::date                     AS day,
    max(online)                                               AS peak_online,
    (array_agg(sampled_at ORDER BY online DESC, sampled_at))[1] AS peak_at
  FROM listener_samples
  GROUP BY 1
) s
WHERE td.day = s.day
  AND td.peak_online = s.peak_online
  AND td.peak_at IS DISTINCT FROM s.peak_at;
