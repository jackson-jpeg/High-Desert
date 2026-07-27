-- High Desert — community stats schema (Postgres, self-hosted).
--
-- Replaces the previous Vercel KV / Redis key layout:
--   ep:{id}              -> episode_plays
--   lb:alltime           -> episode_plays ORDER BY plays DESC
--   lb:week:YYYY-WNN     -> weekly_plays
--   active               -> active_sessions
--   rt:{id}              -> episode_ratings
--   rt:user:{ip}:{id}    -> rating_votes
--
-- Apply with:  psql "$DATABASE_URL" -f scripts/schema.sql   (idempotent)

CREATE TABLE IF NOT EXISTS episode_plays (
  episode_id text PRIMARY KEY,
  plays      bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS episode_plays_plays_idx
  ON episode_plays (plays DESC);

CREATE TABLE IF NOT EXISTS weekly_plays (
  week       text   NOT NULL,
  episode_id text   NOT NULL,
  plays      bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (week, episode_id)
);
CREATE INDEX IF NOT EXISTS weekly_plays_week_plays_idx
  ON weekly_plays (week, plays DESC);

CREATE TABLE IF NOT EXISTS active_sessions (
  session_id text PRIMARY KEY,
  seen_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS active_sessions_seen_at_idx
  ON active_sessions (seen_at);

-- avg is derived on read (sum / count) rather than stored, so it can never
-- drift out of sync with its inputs the way the cached Redis field could.
CREATE TABLE IF NOT EXISTS episode_ratings (
  episode_id text   PRIMARY KEY,
  sum        numeric NOT NULL DEFAULT 0,
  count      bigint  NOT NULL DEFAULT 0
);

-- One row per (voter, episode). Makes re-rating idempotent: the aggregate is
-- adjusted by the delta rather than double-counted.
CREATE TABLE IF NOT EXISTS rating_votes (
  voter      text     NOT NULL,
  episode_id text     NOT NULL,
  rating     smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (voter, episode_id)
);
