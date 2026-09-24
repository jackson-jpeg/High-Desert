#!/usr/bin/env bash
# Deploy the archive.org outage mirror (services/mirror) to /opt/highdesert-mirror.
#
#   bash scripts/deploy-mirror.sh            # stage, install, swap, restart, verify
#   bash scripts/deploy-mirror.sh --rollback # swap back to /opt/highdesert-mirror.prev
#
# The same shape as scripts/deploy.sh, for the same reasons: dependencies are
# installed in a staging copy (never in /root/High-Desert, never under the
# running process), the swap is two renames, and verification is a real range
# request — a failure puts the previous copy back.
#
# Also owns, idempotently: the hdmirror user, its two directories, the units,
# the torrent ports in ufw, and the /mirror/ nginx location (nginx -t first,
# the previous vhost restored if the test fails).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST=/opt/highdesert-mirror
STAGE=$DEST.next
PREV=$DEST.prev
CACHE=/var/cache/highdesert-mirror
STATE=/var/lib/highdesert-mirror
VHOST=/etc/nginx/sites-available/highdesert
log() { printf '[deploy-mirror] %s\n' "$*"; }

verify() {
  local ok=0
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 http://127.0.0.1:3004/mirror/health >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" = 1 ] || { log "health never answered"; return 1; }
  # A real range through nginx, on an indexed episode: while archive.org is up
  # this exercises torrent add + webseed + the range path end to end.
  local fh code
  fh=$(node -e 'const i=require(process.argv[1]);console.log(encodeURIComponent(Object.keys(i)[0]))' "$DEST/episodes.json")
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -H 'Range: bytes=0-4095' "https://highdesert.space/mirror/$fh")
  [ "$code" = 206 ] || { log "range probe returned $code, expected 206"; return 1; }
  log "verified: health OK, range probe 206"
}

swap_back() {
  [ -d "$PREV" ] || { log "no $PREV to roll back to"; return 1; }
  rm -rf "$STAGE"
  mv "$DEST" "$STAGE"
  mv "$PREV" "$DEST"
  mv "$STAGE" "$PREV"
  systemctl restart highdesert-mirror
}

if [ "${1:-}" = "--rollback" ]; then
  swap_back
  verify
  exit 0
fi

dirty=$(git -C "$ROOT" status --porcelain -- services/mirror data/torrents deploy scripts/deploy-mirror.sh)
if [ -n "$dirty" ]; then
  log "refusing: uncommitted changes"; printf '%s\n' "$dirty"; exit 1
fi

# User and directories.
id hdmirror >/dev/null 2>&1 || useradd --system --home-dir "$STATE" --shell /usr/sbin/nologin hdmirror
install -d -o hdmirror -g hdmirror -m 750 "$CACHE" "$STATE" "$STATE/torrents"
chown -R hdmirror:hdmirror "$STATE/torrents"
missing=$(node -e '
  const fs=require("fs");const i=require(process.argv[1]);
  let n=0;for(const e of Object.values(i)) if(!fs.existsSync(process.argv[2]+"/"+e.infohash+".torrent")) n++;
  console.log(n)' "$ROOT/data/torrents/episodes.json" "$STATE/torrents")
[ "$missing" = 0 ] || { log "$missing indexed torrents missing from $STATE/torrents (run scripts/build-torrent-index.mjs --hash)"; exit 1; }

# Stage and install.
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -r "$ROOT/services/mirror/server.mjs" "$ROOT/services/mirror/warm.mjs" "$ROOT/services/mirror/lib" \
      "$ROOT/services/mirror/package.json" "$ROOT/services/mirror/package-lock.json" "$STAGE/"
cp "$ROOT/data/torrents/episodes.json" "$STAGE/episodes.json"
git -C "$ROOT" rev-parse HEAD > "$STAGE/COMMIT"
(cd "$STAGE" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
chown -R root:root "$STAGE"

# Units.
cp "$ROOT"/deploy/highdesert-mirror.service "$ROOT"/deploy/highdesert-mirror-warm.service \
   "$ROOT"/deploy/highdesert-mirror-warm.timer /etc/systemd/system/
systemctl daemon-reload

# Torrent ports: inbound, so the pinned files can actually be seeded back.
ufw allow 6881/tcp comment 'highdesert-mirror bittorrent' >/dev/null
ufw allow 6881/udp comment 'highdesert-mirror utp' >/dev/null
ufw allow 6882/udp comment 'highdesert-mirror dht' >/dev/null

# Swap.
rm -rf "$PREV"
[ -d "$DEST" ] && mv "$DEST" "$PREV"
mv "$STAGE" "$DEST"
systemctl enable highdesert-mirror >/dev/null 2>&1
systemctl restart highdesert-mirror
systemctl enable --now highdesert-mirror-warm.timer >/dev/null 2>&1

# nginx: only when the versioned vhost differs from the installed one.
if ! cmp -s "$ROOT/deploy/nginx/highdesert.conf" "$VHOST"; then
  cp "$VHOST" "$VHOST.bak-mirror"
  cp "$ROOT/deploy/nginx/highdesert.conf" "$VHOST"
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    log "nginx: vhost updated and reloaded"
  else
    cp "$VHOST.bak-mirror" "$VHOST"
    nginx -t
    log "nginx -t failed; previous vhost restored"; exit 1
  fi
fi

if ! verify; then
  log "verification failed — rolling back"
  if [ -d "$PREV" ]; then swap_back; verify || true; else systemctl stop highdesert-mirror; fi
  exit 1
fi
log "deployed $(cat "$DEST/COMMIT")"
