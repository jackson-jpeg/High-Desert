-- High Desert live chat (services/live, highdesert-live.service): the phone lines.
--
-- Lives in the `highdesert` database beside the stats tables, every table
-- prefixed live_. Idempotent: scripts/deploy-live.sh applies it on every
-- deploy, after a pg_dump.
--
-- NO ADDRESSES ANYWHERE. Two kinds of ref, both HMAC-SHA256 under
-- CHAT_CLIENT_SECRET, 64 hex characters (services/live/lib/caller.mjs):
--   client_ref  who is calling: one browser, keyed by the random id in its
--               hd_live_caller cookie (never the cookie itself).
--   addr_ref    where from: the client bucket (IPv4 address or IPv6 /64,
--               src/lib/utils/client-key.ts). A secondary abuse limit only.
-- Before 2026-09-26 client_ref *was* the address bucket; such rows are legacy
-- callers, handed to the first browser from that address (adoptLegacy).
-- The CHECK constraints below refuse anything that is not 64 hex characters,
-- so an address cannot be written here by mistake.
--
-- Retention: live_messages older than 7 days are deleted hourly by the
-- service (and their reports with them, ON DELETE CASCADE); Request Line
-- nominations (and their votes) after 35 days. A locked night keeps its
-- name, place and count, its nomination link set NULL.

CREATE TABLE IF NOT EXISTS live_messages (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  client_ref   text NOT NULL CHECK (client_ref ~ '^[0-9a-f]{64}$'),
  caller_name  text NOT NULL,
  line         int  NOT NULL,
  body         text NOT NULL,
  hidden_at    timestamptz,
  hidden_by    text CHECK (hidden_by IN ('reports', 'admin'))
);
CREATE INDEX IF NOT EXISTS live_messages_at ON live_messages (at);
CREATE INDEX IF NOT EXISTS live_messages_visible ON live_messages (id DESC) WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS live_messages_client ON live_messages (client_ref, at);

CREATE TABLE IF NOT EXISTS live_reports (
  message_id  bigint NOT NULL REFERENCES live_messages (id) ON DELETE CASCADE,
  client_ref  text NOT NULL CHECK (client_ref ~ '^[0-9a-f]{64}$'),
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, client_ref)
);

CREATE TABLE IF NOT EXISTS live_mutes (
  client_ref  text PRIMARY KEY CHECK (client_ref ~ '^[0-9a-f]{64}$'),
  until       timestamptz NOT NULL,
  reason      text NOT NULL
);

CREATE TABLE IF NOT EXISTS live_bans (
  client_ref  text PRIMARY KEY CHECK (client_ref ~ '^[0-9a-f]{64}$'),
  at          timestamptz NOT NULL DEFAULT now()
);

-- One name per caller. `name_key` (lower-cased, accents and punctuation
-- folded) is unique while held; a name is *held* by a caller who is connected
-- or was seen in the last 30 minutes. Taking a name from an idle holder
-- clears theirs (they get a fresh one next time) — the unique index is the
-- arbiter, so two callers can never hold one name at once.
CREATE TABLE IF NOT EXISTS live_names (
  client_ref  text PRIMARY KEY CHECK (client_ref ~ '^[0-9a-f]{64}$'),
  name        text,
  name_key    text,
  changed_at  timestamptz,
  seen_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS live_names_key ON live_names (name_key) WHERE name_key IS NOT NULL;

-- Per-browser callers (2026-09-26): where each message came from, where each
-- report came from (reports hide a message only from distinct addresses, so
-- one person with many cookies cannot mass-report), and each caller's line and
-- last address (so two browsers in one household get different lines).
ALTER TABLE live_messages ADD COLUMN IF NOT EXISTS addr_ref text CHECK (addr_ref ~ '^[0-9a-f]{64}$');
ALTER TABLE live_reports  ADD COLUMN IF NOT EXISTS addr_ref text CHECK (addr_ref ~ '^[0-9a-f]{64}$');
ALTER TABLE live_names    ADD COLUMN IF NOT EXISTS addr_ref text CHECK (addr_ref ~ '^[0-9a-f]{64}$');
ALTER TABLE live_names    ADD COLUMN IF NOT EXISTS line int;
CREATE INDEX IF NOT EXISTS live_names_addr ON live_names (addr_ref, seen_at) WHERE addr_ref IS NOT NULL;

-- "Calling from" (2026-09-27): where a caller says they are, in their own
-- words, optional, filtered like a name. Never derived from an address: the
-- only suggestion is the browser's own time zone, made in the browser. A
-- message keeps the place it was sent with, the way it keeps its name.
ALTER TABLE live_names    ADD COLUMN IF NOT EXISTS place text;
ALTER TABLE live_names    ADD COLUMN IF NOT EXISTS place_changed_at timestamptz;
ALTER TABLE live_messages ADD COLUMN IF NOT EXISTS caller_place text;

-- A ban holds the banned caller's address for a while: new callers from it
-- may start talking at most once per interval (config.mjs, BAN_HOLD_*).
CREATE TABLE IF NOT EXISTS live_address_holds (
  addr_ref  text PRIMARY KEY CHECK (addr_ref ~ '^[0-9a-f]{64}$'),
  until     timestamptz NOT NULL,
  next_at   timestamptz NOT NULL
);

-- Slow mode forced on by an admin. Automatic slow mode is in memory.
CREATE TABLE IF NOT EXISTS live_settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);

-- One-time admin sign-in links (scripts/live-setup.sh). Only the SHA-256 of
-- the nonce is stored; the nonce itself exists in the link file alone.
CREATE TABLE IF NOT EXISTS live_admin_nonces (
  hash        text PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

-- The Request Line (2026-10-14, docs/request-line.md). Listeners nominate one
-- show a day (Pacific) for the station's 10 PM slot and vote with one tap;
-- voting closes at 6 PM Pacific, when live_request_night() locks the winner.
-- A nomination keeps the caller's name and place as they were, the way a
-- message does, and the show's title as the catalog had it. The refs follow
-- the rule above: HMACs, 64 hex, never an address.
CREATE TABLE IF NOT EXISTS live_request_nominations (
  id            bigserial PRIMARY KEY,
  day           date NOT NULL,
  file_hash     text NOT NULL,
  client_ref    text NOT NULL CHECK (client_ref ~ '^[0-9a-f]{64}$'),
  addr_ref      text NOT NULL CHECK (addr_ref ~ '^[0-9a-f]{64}$'),
  caller_name   text NOT NULL,
  caller_place  text,
  note          text,
  title         text NOT NULL,
  air_date      text,
  guest         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  vetoed_at     timestamptz,
  -- One nomination per listener per day; one nomination per show per day
  -- (a second listener asking for it is a vote).
  UNIQUE (day, client_ref),
  UNIQUE (day, file_hash)
);

-- One vote per listener per show (nomination).
CREATE TABLE IF NOT EXISTS live_request_votes (
  nomination_id  bigint NOT NULL REFERENCES live_request_nominations (id) ON DELETE CASCADE,
  client_ref     text NOT NULL CHECK (client_ref ~ '^[0-9a-f]{64}$'),
  addr_ref       text NOT NULL CHECK (addr_ref ~ '^[0-9a-f]{64}$'),
  at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (nomination_id, client_ref)
);
CREATE INDEX IF NOT EXISTS live_request_votes_addr ON live_request_votes (nomination_id, addr_ref);

-- The locked night: one row per day once voting has closed. `file_hash` NULL
-- is a night nobody nominated for (the slot plays the station's own pick).
-- `announced_at` is set once the station has said "Tonight's request, from
-- ..." in the lines, so a restart never says it twice.
CREATE TABLE IF NOT EXISTS live_request_nights (
  day            date PRIMARY KEY,
  nomination_id  bigint REFERENCES live_request_nominations (id) ON DELETE SET NULL,
  file_hash      text,
  caller_name    text,
  caller_place   text,
  votes          int NOT NULL DEFAULT 0,
  locked_at      timestamptz NOT NULL DEFAULT now(),
  announced_at   timestamptz
);

-- Lock (once) and return the night of p_day. Before 6 PM Pacific on p_day it
-- returns nothing. From 6 PM on: the nomination with the most votes cast
-- before 6 PM, among those made before 6 PM and not vetoed; a tie goes to the
-- earliest nomination. ON CONFLICT DO NOTHING makes two first callers (the
-- app's schedule and the phone lines) agree: whoever inserts first decides,
-- and both read the same row back. One function, in the database, so the app
-- and the service cannot disagree on the rule.
CREATE OR REPLACE FUNCTION live_request_night(p_day date, p_now timestamptz DEFAULT now())
RETURNS SETOF live_request_nights
LANGUAGE plpgsql AS $fn$
DECLARE
  close_at timestamptz := (p_day + time '18:00') AT TIME ZONE 'America/Los_Angeles';
BEGIN
  IF p_now < close_at THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM live_request_nights WHERE day = p_day) THEN
    INSERT INTO live_request_nights (day, nomination_id, file_hash, caller_name, caller_place, votes)
    SELECT p_day, w.id, w.file_hash, w.caller_name, w.caller_place, coalesce(w.votes, 0)
      FROM (SELECT 1) one
      LEFT JOIN LATERAL (
        SELECT n.id, n.file_hash, n.caller_name, n.caller_place, count(v.client_ref)::int AS votes
          FROM live_request_nominations n
          LEFT JOIN live_request_votes v ON v.nomination_id = n.id AND v.at < close_at
         WHERE n.day = p_day AND n.vetoed_at IS NULL AND n.created_at < close_at
         GROUP BY n.id
         ORDER BY count(v.client_ref) DESC, n.created_at, n.id
         LIMIT 1
      ) w ON true
    ON CONFLICT (day) DO NOTHING;
  END IF;
  RETURN QUERY SELECT * FROM live_request_nights WHERE day = p_day;
END
$fn$;

-- The service's own role, least privilege: these tables and nothing else.
-- Created by scripts/live-setup.sh; absent in test databases, so conditional.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'highdesert_live') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      live_messages, live_reports, live_mutes, live_bans, live_names, live_settings, live_admin_nonces,
      live_address_holds, live_request_nominations, live_request_votes, live_request_nights
      TO highdesert_live;
    GRANT USAGE, SELECT ON SEQUENCE live_messages_id_seq, live_request_nominations_id_seq TO highdesert_live;
    -- The Request Line reads what the station played (the 30-day rule) and
    -- which files are known broken; the app's schema owns both tables.
    IF to_regclass('live_days') IS NOT NULL THEN
      GRANT SELECT ON live_days TO highdesert_live;
    END IF;
    IF to_regclass('audio_checks') IS NOT NULL THEN
      GRANT SELECT ON audio_checks TO highdesert_live;
    END IF;
  END IF;
END
$$;
