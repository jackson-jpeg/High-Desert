#!/usr/bin/env bash
# One-time (and safely re-runnable) setup for highdesert-live, the phone lines.
#
#   bash scripts/live-setup.sh          # env file + database role (nothing regenerated if present)
#   bash scripts/live-setup.sh --link   # only mint a fresh one-time admin sign-in link
#
# Order on a first install:
#   bash scripts/live-setup.sh    # secrets and role
#   bash scripts/deploy-live.sh   # schema (grants the role), unit, nginx, verify
#   bash scripts/live-setup.sh --link
#
# What it owns, idempotently:
#   /root/.high-desert-live.env (root, chmod 600), read by the unit's
#   EnvironmentFile=. Holds LIVE_ADMIN_TOKEN (32 random bytes, hex — the admin
#   credential), CHAT_CLIENT_SECRET (the HMAC key clients are known by) and
#   LIVE_DATABASE_URL. Values already present are kept: regenerating
#   CHAT_CLIENT_SECRET would re-key every caller (names, mutes, bans), and
#   regenerating the token would sign every admin out.
#
#   The Postgres role highdesert_live: LOGIN, CONNECT on highdesert, nothing
#   else. Table privileges come from services/live/schema.sql, which grants
#   exactly the seven live_* tables when the role exists.
#
# The sign-in link: https://highdesert.space/live-api/admin/signin-page#<nonce>.
# The nonce is 32 random bytes, stored only as its SHA-256, single-use, and
# expires in 24 hours. The long-lived token is never in the link, never on
# stdout, never in a file outside the env file. The link is written to a
# timestamped markdown file and copied to the MacBook's ~/Downloads; if the Mac
# is unreachable it is staged in /root/.high-desert-live-links/ and this says so.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=${HD_LIVE_ENV_FILE:-/root/.high-desert-live.env}
APP_ENV=${HD_APP_ENV_FILE:-/root/.high-desert.env}
STAGED=${HD_LIVE_LINK_DIR:-/root/.high-desert-live-links}
ROLE=highdesert_live
DB=highdesert
SITE=https://highdesert.space
log() { printf '[live-setup] %s\n' "$*"; }

umask 077
[ "$(id -u)" = 0 ] || { log "run as root"; exit 1; }

# The owner's URL (tables are created and nonces minted as the owner, as
# scripts/schema.sql is applied). Read without echoing it.
owner_url() {
  local url
  url=$(set -a; . "$APP_ENV"; set +a; printf '%s' "${DATABASE_URL:-}")
  [ -n "$url" ] || { log "no DATABASE_URL in $APP_ENV"; exit 1; }
  printf '%s' "$url"
}

tables_exist() {
  local n
  n=$(psql "$(owner_url)" -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'live_admin_nonces'")
  [ "$n" = 1 ]
}

mint_link() {
  if ! tables_exist; then
    log "the live tables do not exist yet: run scripts/deploy-live.sh, then: bash scripts/live-setup.sh --link"
    return 0
  fi
  local nonce hash stamp file
  nonce=$(openssl rand -hex 32)
  hash=$(printf '%s' "$nonce" | sha256sum | cut -d' ' -f1)
  psql "$(owner_url)" -qv ON_ERROR_STOP=1 -v h="$hash" \
    -c "INSERT INTO live_admin_nonces (hash, expires_at) VALUES (:'h', now() + interval '24 hours')" >/dev/null
  stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
  install -d -m 700 "$STAGED"
  file="$STAGED/highdesert-live-admin-signin-$stamp.md"
  cat > "$file" <<EOF
# High Desert — phone lines admin sign-in

Minted $(date -u '+%Y-%m-%d %H:%M UTC'). **Works once, and only until $(date -u -d '+24 hours' '+%Y-%m-%d %H:%M UTC').**

Open this on the device you want to moderate from:

$SITE/live-api/admin/signin-page#$nonce

It signs that browser in for 30 days (an HttpOnly cookie; the part after \`#\`
never leaves the browser except in the one sign-in request). After that, or on
another device, ask for a fresh link: \`bash scripts/live-setup.sh --link\` on
the VPS. Signing out is on the phone lines' admin menu.

Delete this file once you have used it.
EOF
  chmod 600 "$file"
  if scp -q -o ConnectTimeout=10 -o BatchMode=yes "$file" macbook:Downloads/ 2>/dev/null; then
    log "sign-in link copied to the Mac: ~/Downloads/$(basename "$file") (one use, 24 h)"
  else
    log "the Mac is unreachable: sign-in link staged at $file (one use, 24 h). Copy it with: scp $file macbook:Downloads/"
  fi
}

if [ "${1:-}" = "--link" ]; then
  mint_link
  exit 0
fi

# --- env file ------------------------------------------------------------------
touch "$ENV_FILE"
chown root:root "$ENV_FILE"
chmod 600 "$ENV_FILE"
has() { grep -q "^$1=." "$ENV_FILE"; }
added=()
if ! has LIVE_ADMIN_TOKEN; then
  printf 'LIVE_ADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "$ENV_FILE"; added+=(LIVE_ADMIN_TOKEN)
fi
if ! has CHAT_CLIENT_SECRET; then
  printf 'CHAT_CLIENT_SECRET=%s\n' "$(openssl rand -hex 32)" >> "$ENV_FILE"; added+=(CHAT_CLIENT_SECRET)
fi

# --- database role ---------------------------------------------------------------
exists=$(runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_roles WHERE rolname = '$ROLE'")
if [ "$exists" != 1 ] || ! has LIVE_DATABASE_URL; then
  # A fresh password whenever the URL is missing: the only copy is the env file.
  pw=$(openssl rand -hex 24)
  if [ "$exists" != 1 ]; then
    runuser -u postgres -- psql -qv ON_ERROR_STOP=1 -v pw="$pw" \
      -c "CREATE ROLE $ROLE LOGIN PASSWORD :'pw'" >/dev/null
    log "created role $ROLE"
  else
    runuser -u postgres -- psql -qv ON_ERROR_STOP=1 -v pw="$pw" \
      -c "ALTER ROLE $ROLE PASSWORD :'pw'" >/dev/null
  fi
  sed -i '/^LIVE_DATABASE_URL=/d' "$ENV_FILE"
  printf 'LIVE_DATABASE_URL=postgres://%s:%s@127.0.0.1:5432/%s\n' "$ROLE" "$pw" "$DB" >> "$ENV_FILE"
  added+=(LIVE_DATABASE_URL)
  unset pw
fi
runuser -u postgres -- psql -qv ON_ERROR_STOP=1 -c "GRANT CONNECT ON DATABASE $DB TO $ROLE" >/dev/null
# If the tables already exist, (re)grant them now; otherwise deploy-live.sh's
# schema run does it.
if tables_exist; then
  psql "$(owner_url)" -qv ON_ERROR_STOP=1 -c "SET client_min_messages = warning" -f "$ROOT/services/live/schema.sql" >/dev/null
fi

if [ ${#added[@]} -gt 0 ]; then
  log "wrote ${added[*]} to $ENV_FILE (chmod 600; values not shown)"
else
  log "$ENV_FILE already complete; nothing regenerated"
fi
# A link on the first run only; later ones are asked for with --link, so
# re-running setup never leaves a stray live nonce behind.
if [ "${#added[@]}" -gt 0 ] && systemctl is-active --quiet highdesert-live; then
  log "highdesert-live is running with the old environment: systemctl restart highdesert-live"
fi

for k in "${added[@]}"; do
  if [ "$k" = LIVE_ADMIN_TOKEN ]; then mint_link; fi
done
