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

-- Presence. `seen_at` is refreshed by a heartbeat from every open tab, so it
-- answers "who is on the site". `listening_at` is set only by a play event, so
-- it answers "who has audio going". Until listening_at existed this table was
-- written solely by recordPlay, which meant the number the UI called "active
-- listeners" silently excluded everyone who was browsing.
CREATE TABLE IF NOT EXISTS active_sessions (
  session_id text PRIMARY KEY,
  seen_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE active_sessions
  ADD COLUMN IF NOT EXISTS listening_at timestamptz;
CREATE INDEX IF NOT EXISTS active_sessions_seen_at_idx
  ON active_sessions (seen_at);
CREATE INDEX IF NOT EXISTS active_sessions_listening_at_idx
  ON active_sessions (listening_at);

-- Traffic history. active_sessions is a live set that getPresence() prunes as
-- it counts, and episode_plays is a running total with no timestamps, so before
-- this table nothing in the system retained *when* anything happened — there
-- was no way to draw a trend.
--
-- total_plays is the running SUM(episode_plays.plays) at sample time; the API
-- derives per-bucket deltas from consecutive rows. Storing the cumulative value
-- rather than a delta means a missed sample degrades to a flat segment instead
-- of inventing a spike.
CREATE TABLE IF NOT EXISTS listener_samples (
  sampled_at  timestamptz PRIMARY KEY,
  online      int    NOT NULL DEFAULT 0,
  listening   int    NOT NULL DEFAULT 0,
  total_plays bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS listener_samples_sampled_at_idx
  ON listener_samples (sampled_at DESC);

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
