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
-- What that session is playing, so the site can show *what* the community is
-- listening to and not merely how many people are here. Cleared alongside
-- listening_at when playback stops. Never joined to session_id on read: the
-- API only ever returns per-episode counts.
ALTER TABLE active_sessions
  ADD COLUMN IF NOT EXISTS episode_id text;
CREATE INDEX IF NOT EXISTS active_sessions_seen_at_idx
  ON active_sessions (seen_at);
CREATE INDEX IF NOT EXISTS active_sessions_listening_at_idx
  ON active_sessions (listening_at);

-- Rolling log of individual play events, 24h retention.
--
-- episode_plays is a counter and listener_samples only stores a cumulative
-- total, so neither can answer "what did someone just put on" — the single
-- most alive thing this site can show. Deliberately holds no session id: it
-- records that an episode was played, not who played it.
CREATE TABLE IF NOT EXISTS recent_plays (
  id         bigserial PRIMARY KEY,
  episode_id text        NOT NULL,
  played_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recent_plays_played_at_idx
  ON recent_plays (played_at DESC);

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
