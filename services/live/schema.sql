-- High Desert live chat (services/live, highdesert-live.service): the phone lines.
--
-- Lives in the `highdesert` database beside the stats tables, every table
-- prefixed live_. Idempotent: scripts/deploy-live.sh applies it on every
-- deploy, after a pg_dump.
--
-- NO ADDRESSES ANYWHERE. A caller is `client_ref`: HMAC-SHA256 of the client
-- bucket (IPv4 address or IPv6 /64, src/lib/utils/client-key.ts) under
-- CHAT_CLIENT_SECRET, 64 hex characters. The CHECK constraints below refuse
-- anything else, so an address cannot be written here by mistake.
--
-- Retention: live_messages older than 7 days are deleted hourly by the
-- service (and their reports with them, ON DELETE CASCADE).

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

-- The service's own role, least privilege: these tables and nothing else.
-- Created by scripts/live-setup.sh; absent in test databases, so conditional.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'highdesert_live') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      live_messages, live_reports, live_mutes, live_bans, live_names, live_settings, live_admin_nonces
      TO highdesert_live;
    GRANT USAGE, SELECT ON SEQUENCE live_messages_id_seq TO highdesert_live;
  END IF;
END
$$;
