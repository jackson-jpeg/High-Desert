#!/usr/bin/env bash
# Deploy the phone lines (services/live) to /opt/highdesert-live.
#
#   bash scripts/deploy-live.sh              # stage, install, schema, swap, restart, verify
#   bash scripts/deploy-live.sh --rollback   # swap back to /opt/highdesert-live.prev
#   bash scripts/deploy-live.sh --blocklist  # copy data/chat-blocklist.txt and reload (no restart)
#   bash scripts/deploy-live.sh --verify-only # the three checks below, against what is running
#
# Run scripts/live-setup.sh first (env file and database role). The same shape
# as scripts/deploy-mirror.sh: dependencies are installed in a staging copy
# (never in /root/High-Desert, never under the running process), the swap is
# two renames, and a failed verification puts the previous copy back.
#
# Also owns, idempotently: the hdlive user, the unit, the /live-api/ nginx
# locations (nginx -t first; the previous vhost restored if the test fails or
# the deploy does not verify) and the live_* tables (services/live/schema.sql,
# applied after a pg_dump of the database).
#
# Verification, all of which must pass:
#   1. /live-api/health answers on 127.0.0.1:3005 (nginx 404s it publicly);
#   2. an SSE handshake through https://highdesert.space/live-api/stream
#      delivers `event: hello` — nginx is streaming, not buffering;
#   3. a POST round trip through nginx: /live-api/admin/verify, with the admin
#      token, writes a hidden row as the service's own role, reads it back and
#      deletes it. Nobody on the lines sees it.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST=/opt/highdesert-live
STAGE=$DEST.next
PREV=$DEST.prev
VHOST=/etc/nginx/sites-available/highdesert
ENV_FILE=${HD_LIVE_ENV_FILE:-/root/.high-desert-live.env}
APP_ENV=/root/.high-desert.env
BACKUPS=/root/backups/highdesert
SITE=${HD_LIVE_SITE:-https://highdesert.space}
LOCAL=${HD_LIVE_LOCAL:-http://127.0.0.1:3005}
log() { printf '[deploy-live] %s\n' "$*"; }

verify() {
  local ok=0
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 "$LOCAL/live-api/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" = 1 ] || { log "health never answered on $LOCAL"; return 1; }

  local tmp
  tmp=$(mktemp -d)
  chmod 700 "$tmp"
  # The stream never ends by itself: curl stops at --max-time (exit 28), which
  # is expected. What matters is what arrived before then.
  curl -sN --max-time 5 -H 'Accept: text/event-stream' "$SITE/live-api/stream" > "$tmp/sse" 2>/dev/null || true
  if ! grep -q '^event: hello' "$tmp/sse"; then
    log "no SSE hello through nginx (first bytes: $(head -c 200 "$tmp/sse" | tr '\n' ' '))"
    rm -rf "$tmp"; return 1
  fi

  # The token goes in a header file (never on a command line, never printed).
  (set -a; . "$ENV_FILE"; set +a; printf 'Authorization: Bearer %s\n' "$LIVE_ADMIN_TOKEN") > "$tmp/auth"
  local code
  code=$(curl -s -o "$tmp/verify" -w '%{http_code}' --max-time 10 -X POST \
    -H @"$tmp/auth" -H 'Content-Type: application/json' -H "Origin: $SITE" \
    --data '{}' "$SITE/live-api/admin/verify") || code=000
  if [ "$code" != 200 ] || ! grep -q '"ok":true' "$tmp/verify"; then
    log "POST round trip returned $code: $(head -c 200 "$tmp/verify")"
    rm -rf "$tmp"; return 1
  fi
  rm -rf "$tmp"
  log "verified: health OK, SSE hello through nginx, POST round trip through nginx and Postgres"
}

swap_back() {
  [ -d "$PREV" ] || { log "no $PREV to roll back to"; return 1; }
  rm -rf "$STAGE"
  mv "$DEST" "$STAGE"
  mv "$PREV" "$DEST"
  mv "$STAGE" "$PREV"
  systemctl restart highdesert-live
}

refuse_dirty() {
  local dirty
  dirty=$(git -C "$ROOT" status --porcelain -- "$@")
  if [ -n "$dirty" ]; then
    log "refusing: uncommitted changes"; printf '%s\n' "$dirty"; exit 1
  fi
}

case "${1:-}" in
  --verify-only)
    verify
    exit 0
    ;;
  --rollback)
    swap_back
    verify
    exit 0
    ;;
  --blocklist)
    refuse_dirty data/chat-blocklist.txt
    # Parse it with the deployed code first: a malformed line is reported, not
    # silently skipped on the live service.
    node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const { parseBlocklist } = await import(process.argv[1]);
      const { entries, errors } = parseBlocklist(readFileSync(process.argv[2], "utf8"));
      if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
      console.log(`[deploy-live] blocklist parses: ${entries.length} entries`);
    ' "$DEST/lib/moderation/blocklist.mjs" "$ROOT/data/chat-blocklist.txt"
    install -m 644 "$ROOT/data/chat-blocklist.txt" "$DEST/chat-blocklist.txt"
    systemctl reload highdesert-live
    log "blocklist installed and reloaded (SIGHUP; no stream dropped)"
    exit 0
    ;;
  "") ;;
  *) log "unknown option $1"; exit 2 ;;
esac

refuse_dirty services/live data/chat-blocklist.txt deploy scripts/deploy-live.sh src/lib/utils/client-key.ts
[ -s "$ENV_FILE" ] || { log "$ENV_FILE missing: run scripts/live-setup.sh first"; exit 1; }
for k in LIVE_ADMIN_TOKEN CHAT_CLIENT_SECRET LIVE_DATABASE_URL; do
  grep -q "^$k=." "$ENV_FILE" || { log "$k missing from $ENV_FILE: run scripts/live-setup.sh"; exit 1; }
done
grep -q '^LIVE_LOAD_TEST=' "$ENV_FILE" && { log "refusing: LIVE_LOAD_TEST is set in $ENV_FILE"; exit 1; }
grep -q '^LIVE_INSECURE_COOKIES=' "$ENV_FILE" && { log "refusing: LIVE_INSECURE_COOKIES is set in $ENV_FILE"; exit 1; }

# User.
id hdlive >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin hdlive

# Stage and install. -L: lib/shared/client-key.ts is a symlink into the app's
# src/ (one implementation of the client key); the copy must be the file.
rm -rf "$STAGE"
mkdir -p "$STAGE/docs"
cp -rL "$ROOT/services/live/server.mjs" "$ROOT/services/live/lib" "$ROOT/services/live/scripts" \
       "$ROOT/services/live/schema.sql" "$ROOT/services/live/package.json" "$ROOT/services/live/package-lock.json" "$STAGE/"
cp "$ROOT/data/chat-blocklist.txt" "$STAGE/chat-blocklist.txt"
cp "$ROOT/docs/live-chat.md" "$STAGE/docs/live-chat.md"
git -C "$ROOT" rev-parse HEAD > "$STAGE/COMMIT"
(cd "$STAGE" && nice -n 10 npm ci --omit=dev --no-audit --no-fund --loglevel=error)
[ -L "$STAGE/lib/shared/client-key.ts" ] && { log "client-key.ts is still a symlink in the stage"; exit 1; }
chown -R root:root "$STAGE"
chmod -R go-w,a+rX "$STAGE"

# Schema: a dump first, then the idempotent schema (which grants the role).
OWNER_URL=$(set -a; . "$APP_ENV"; set +a; printf '%s' "${DATABASE_URL:-}")
[ -n "$OWNER_URL" ] || { log "no DATABASE_URL in $APP_ENV"; exit 1; }
install -d -m 700 "$BACKUPS"
dump="$BACKUPS/pre-live-$(date -u +%Y%m%dT%H%M%SZ).dump"
nice -n 10 pg_dump "$OWNER_URL" --format=custom --file="$dump"
log "pre-schema dump: $dump"
psql "$OWNER_URL" -qv ON_ERROR_STOP=1 -c "SET client_min_messages = warning" -f "$STAGE/schema.sql" >/dev/null
log "schema applied"

# Unit.
cp "$ROOT/deploy/highdesert-live.service" /etc/systemd/system/
systemctl daemon-reload

# Swap.
rm -rf "$PREV"
[ -d "$DEST" ] && mv "$DEST" "$PREV"
mv "$STAGE" "$DEST"
systemctl enable highdesert-live >/dev/null 2>&1
systemctl restart highdesert-live

# nginx: only when the versioned vhost differs from the installed one.
vhost_changed=0
if ! cmp -s "$ROOT/deploy/nginx/highdesert.conf" "$VHOST"; then
  cp "$VHOST" "$VHOST.bak-live"
  cp "$ROOT/deploy/nginx/highdesert.conf" "$VHOST"
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    vhost_changed=1
    log "nginx: vhost updated and reloaded"
  else
    cp "$VHOST.bak-live" "$VHOST"
    nginx -t
    log "nginx -t failed; previous vhost restored"
    if [ -d "$PREV" ]; then swap_back; else systemctl stop highdesert-live; fi
    exit 1
  fi
fi

if ! verify; then
  log "verification failed — rolling back"
  if [ "$vhost_changed" = 1 ]; then
    cp "$VHOST.bak-live" "$VHOST"
    nginx -t 2>/dev/null && systemctl reload nginx
    log "nginx: previous vhost restored"
  fi
  if [ -d "$PREV" ]; then swap_back; verify || true; else systemctl stop highdesert-live; fi
  exit 1
fi
log "deployed $(cat "$DEST/COMMIT")"
