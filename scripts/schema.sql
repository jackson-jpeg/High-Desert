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

-- ---------------------------------------------------------------------------
-- Permanent history
--
-- Everything above is either a counter with no timestamps (episode_plays), a
-- live set that is pruned as it is read (active_sessions), a 24h ticker
-- (recent_plays) or a 90-day sample window (listener_samples). None of it can
-- answer "what was played on a Tuesday last spring". These two tables are the
-- forever log, and they are the only tables here that are never pruned.
-- ---------------------------------------------------------------------------

-- One row per play, kept indefinitely.
--
-- Distinct from recent_plays, which is a 24h ticker feeding the "on air" strip
-- and is pruned in the same statement that writes it. This one only grows: at
-- the site's traffic a decade of plays is still a few hundred thousand rows.
--
-- session_ref carries the anonymous per-page-load id so a listening session's
-- sequence of plays can be reconstructed while it is recent. It is NULLed out
-- after SESSION_REF_RETENTION_DAYS by anonymizeOldSessions(), so the permanent
-- record degrades to exactly what recent_plays always was — an episode and a
-- time, attached to nobody. The id was never linkable to a person or to a
-- returning visitor (see src/lib/utils/session-id.ts); expiring it means the
-- long tail cannot even group one session's listening after the fact.
CREATE TABLE IF NOT EXISTS play_events (
  id          bigserial   PRIMARY KEY,
  episode_id  text        NOT NULL,
  played_at   timestamptz NOT NULL DEFAULT now(),
  session_ref text
);
CREATE INDEX IF NOT EXISTS play_events_played_at_idx
  ON play_events (played_at DESC);
CREATE INDEX IF NOT EXISTS play_events_episode_idx
  ON play_events (episode_id, played_at DESC);
-- Partial: anonymizeOldSessions() only ever looks for rows that still have a
-- ref, and after the first pass that is a small recent slice of the table.
CREATE INDEX IF NOT EXISTS play_events_session_ref_idx
  ON play_events (played_at) WHERE session_ref IS NOT NULL;

-- Daily rollup of traffic, kept indefinitely.
--
-- listener_samples is pruned at 90 days because 2-minute resolution is only
-- interesting while it is recent. Rolling each day up before that happens is
-- what makes multi-year history possible without keeping 650k sample rows a
-- year. Recomputed for the last few days on every sample, so a late-arriving
-- or corrected sample is picked up rather than frozen in.
CREATE TABLE IF NOT EXISTS traffic_daily (
  day            date   PRIMARY KEY,
  peak_online    int    NOT NULL DEFAULT 0,
  peak_listening int    NOT NULL DEFAULT 0,
  avg_online     numeric NOT NULL DEFAULT 0,
  avg_listening  numeric NOT NULL DEFAULT 0,
  plays          bigint NOT NULL DEFAULT 0,
  -- Distinct session_refs seen that day. Goes stale-but-correct once the refs
  -- expire: the count is written at rollup time, not derived on read.
  sessions       int    NOT NULL DEFAULT 0,
  samples        int    NOT NULL DEFAULT 0
);

-- Playback failures.
--
-- Added after a user reported that shows "sometimes don't start" and assumed it
-- was their own fault. The direct cause was client-side, but the reason it went
-- unreported for so long is that a failed play left no trace anywhere: it was
-- invisible to them and invisible to us. This table is the trace.
--
-- Deliberately thinner than play_events. There is no session ref and no ip:
-- the question it answers is "which episodes fail, on what kind of device",
-- which needs counts per episode and nothing per person. `ua_class` is a
-- seven-value bucket (see src/lib/utils/platform.ts), never a raw user-agent.
--
-- Pruned at 90 days in the same statement that inserts, like recent_plays.
-- Unlike play_events this is operational data, not a record worth keeping: once
-- a bad episode is fixed, its failures are noise.
CREATE TABLE IF NOT EXISTS playback_failures (
  id         bigserial   PRIMARY KEY,
  episode_id text        NOT NULL,
  -- timeout | stall | play-rejected | network-error | decode-error | empty-media
  -- empty-media is the odd one: the transfer succeeded and the file contains no
  -- broadcast, so it is never retried and points at the catalog, not the network.
  kind       text        NOT NULL,
  -- Whether the automatic retry ran, and whether it rescued the listen. A
  -- recovered=true row means nobody saw a problem but the episode is flaky.
  retried    boolean     NOT NULL DEFAULT false,
  recovered  boolean     NOT NULL DEFAULT false,
  elapsed_ms integer     NOT NULL DEFAULT 0,
  ua_class   text        NOT NULL DEFAULT 'other',
  at         timestamptz NOT NULL DEFAULT now()
);
-- Free-text context, only ever written for advisory kinds. Today that is
-- empty-media-suspected, which carries the duration `loadedmetadata` claimed so
-- the five-second floor can be judged against real traffic before it is given
-- the power to stop a show. Added separately so re-running this file on a
-- database that predates it is still a no-op.
ALTER TABLE playback_failures
  ADD COLUMN IF NOT EXISTS detail text;

CREATE INDEX IF NOT EXISTS playback_failures_at_idx
  ON playback_failures (at DESC);
CREATE INDEX IF NOT EXISTS playback_failures_episode_idx
  ON playback_failures (episode_id, at DESC);
