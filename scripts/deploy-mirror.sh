#!/usr/bin/env bash
# Deploy the archive.org outage mirror. There is no mirror process any more:
# nginx serves the pins off disk and fills the rest from archive.org through
# its own cache (services/mirror/lib/nginx.mjs). What this installs:
#
#   /opt/highdesert-mirror                 warm.mjs, migrate.mjs, build-static.mjs,
#                                          verify.mjs, lib/, episodes.json (no deps)
#   /var/lib/highdesert-mirror/catalog     one file per catalog episode: its magnet
#                                          JSON, and the allowlist for /mirror/{fileHash}
#   /var/lib/highdesert-mirror/pins        the pinned episodes (warm job; migration)
#   /var/lib/highdesert-mirror/manifest.json
#   /etc/nginx/highdesert-mirror/{http,locations}.conf, and the vhost that includes them
#   highdesert-mirror-warm.{service,timer}
#
# and removes, idempotently: the highdesert-mirror (webtorrent) unit and its
# ufw ports. The first run moves the gateway's verified files into the pin
# directory (services/mirror/migrate.mjs — renames, nothing re-downloaded).
#
#   bash scripts/deploy-mirror.sh            # stage, migrate, install, verify
#   bash scripts/deploy-mirror.sh --rollback # back to what the previous deploy left
#
# Verification is services/mirror/verify.mjs through https://highdesert.space
# (manifest 200 + 304, pinned 206 + 416, an unpinned fill, a magnet, a 404).
# A failure rolls back — to the torrent gateway, if that is what was there.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST=/opt/highdesert-mirror
STAGE=$DEST.next
PREV=$DEST.prev
CACHE=/var/cache/highdesert-mirror
STATE=/var/lib/highdesert-mirror
NGX=/etc/nginx/highdesert-mirror
VHOST=/etc/nginx/sites-available/highdesert
OLD_UNIT=/etc/systemd/system/highdesert-mirror.service
SITE="${HD_SITE:-https://highdesert.space}"
TORRENT_PORTS=(6881/tcp 6881/udp 6882/udp)
log() { printf '[deploy-mirror] %s\n' "$*"; }
as_mirror() { runuser -u hdmirror -- env MIRROR_CACHE_DIR="$CACHE" MIRROR_STATE_DIR="$STATE" "$@"; }

verify() {
  nice -n 10 node "$DEST/verify.mjs" "$SITE" --index "$DEST/episodes.json"
}

# $1 = new includes dir, $2 = new vhost file. nginx -t before reload; on
# failure the previous vhost and includes go back and nothing is reloaded.
nginx_swap_in() {
  rm -rf "$NGX.prev"
  if [ -d "$NGX" ]; then cp -a "$NGX" "$NGX.prev"; fi
  cp "$VHOST" "$VHOST.bak-mirror"
  rm -rf "$NGX"
  cp -a "$1" "$NGX"
  cp "$2" "$VHOST"
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    return 0
  fi
  nginx -t || true
  nginx_restore
  return 1
}

nginx_restore() {
  cp "$VHOST.bak-mirror" "$VHOST"
  rm -rf "$NGX"
  if [ -d "$NGX.prev" ]; then cp -a "$NGX.prev" "$NGX"; fi
  nginx -t && systemctl reload nginx
}

catalog_swap() { # $1 = new catalog dir
  rm -rf "$STATE/catalog.prev"
  if [ -d "$STATE/catalog" ]; then mv "$STATE/catalog" "$STATE/catalog.prev"; fi
  mv "$1" "$STATE/catalog"
}

# Back to the webtorrent gateway: possible while its copy (code, node_modules
# and unit file) is in $PREV — i.e. until the deploy after this one.
back_to_gateway() {
  log "restoring the torrent gateway from $PREV"
  as_mirror MIRROR_INDEX="$PREV/episodes.json" node "$DEST/migrate.mjs" --reverse
  cp "$PREV/highdesert-mirror.service" "$OLD_UNIT"
  for p in "${TORRENT_PORTS[@]}"; do ufw allow "$p" comment 'highdesert-mirror bittorrent' >/dev/null; done
  systemctl daemon-reload
  systemctl enable highdesert-mirror >/dev/null 2>&1
}

rollback() {
  if [ ! -d "$PREV" ]; then log "no $PREV to roll back to"; return 1; fi
  local to_gateway=0
  if [ -f "$PREV/server.mjs" ] && [ -f "$PREV/highdesert-mirror.service" ]; then to_gateway=1; fi
  if [ "$to_gateway" = 1 ]; then back_to_gateway; fi
  rm -rf "$STAGE"
  mv "$DEST" "$STAGE"
  mv "$PREV" "$DEST"
  mv "$STAGE" "$PREV"
  if [ "$to_gateway" = 1 ]; then systemctl restart highdesert-mirror; fi
  nginx_restore
  if [ -d "$STATE/catalog.prev" ]; then
    rm -rf "$STATE/catalog.bad"
    mv "$STATE/catalog" "$STATE/catalog.bad"
    mv "$STATE/catalog.prev" "$STATE/catalog"
  fi
  log "rolled back to $(cat "$DEST/COMMIT" 2>/dev/null || echo '?')"
}

if [ "${1:-}" = "--rollback" ]; then
  rollback
  exit 0
fi

dirty=$(git -C "$ROOT" status --porcelain -- services/mirror data/torrents deploy scripts/deploy-mirror.sh)
if [ -n "$dirty" ]; then
  log "refusing: uncommitted changes"; printf '%s\n' "$dirty"; exit 1
fi
ngx_build=$(nginx -V 2>&1) || { log "no nginx"; exit 1; }
if [[ "$ngx_build" != *--with-http_slice_module* ]]; then log "this nginx has no slice module"; exit 1; fi

# User and directories. nginx (www-data) reads the pins, the catalog and the
# manifest, and owns its cache directory.
id hdmirror >/dev/null 2>&1 || useradd --system --home-dir "$STATE" --shell /usr/sbin/nologin hdmirror
install -d -o hdmirror -g hdmirror -m 755 "$CACHE" "$STATE" "$STATE/pins"
install -d -o hdmirror -g hdmirror -m 700 "$STATE/tmp"
install -d -o hdmirror -g hdmirror -m 750 "$STATE/torrents"
install -d -o www-data -g www-data -m 700 "$CACHE/proxy"
missing=$(node -e '
  const fs=require("fs");const i=require(process.argv[1]);
  let n=0;for(const e of Object.values(i)) if(!fs.existsSync(process.argv[2]+"/"+e.infohash+".torrent")) n++;
  console.log(n)' "$ROOT/data/torrents/episodes.json" "$STATE/torrents")
[ "$missing" = 0 ] || { log "$missing indexed torrents missing from $STATE/torrents (run scripts/build-torrent-index.mjs --hash)"; exit 1; }

# Stage. No dependencies: nothing to install.
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -r "$ROOT/services/mirror/warm.mjs" "$ROOT/services/mirror/migrate.mjs" "$ROOT/services/mirror/build-static.mjs" \
      "$ROOT/services/mirror/verify.mjs" "$ROOT/services/mirror/lib" "$ROOT/services/mirror/package.json" "$STAGE/"
cp "$ROOT/data/torrents/episodes.json" "$STAGE/episodes.json"
git -C "$ROOT" rev-parse HEAD > "$STAGE/COMMIT"
chown -R root:root "$STAGE"
# The gateway's unit, kept beside its code so --rollback can put it back.
if [ -f "$OLD_UNIT" ] && [ -d "$DEST" ]; then cp "$OLD_UNIT" "$DEST/highdesert-mirror.service"; fi

# Generated: the catalog directory and the nginx includes.
rm -rf "$STATE/catalog.next" "$NGX.next"
node "$STAGE/build-static.mjs" --index "$STAGE/episodes.json" --torrents "$STATE/torrents" \
  --catalog "$STATE/catalog.next" --nginx "$NGX.next"
chmod 755 "$STATE/catalog.next"

# The gateway stops before its files move (it would otherwise be serving from
# and writing to the same directory). /mirror/ answers 502 from here until
# nginx is reloaded below — seconds.
if [ -f "$OLD_UNIT" ]; then systemctl stop highdesert-mirror || true; fi

# One-time migration, idempotent: the gateway's verified files into pins/.
as_mirror MIRROR_INDEX="$STAGE/episodes.json" nice -n 10 node "$STAGE/migrate.mjs" --drop-partials

catalog_swap "$STATE/catalog.next"
if ! nginx_swap_in "$NGX.next" "$ROOT/deploy/nginx/highdesert.conf"; then
  log "nginx -t failed; previous vhost and includes restored"
  rm -rf "$STATE/catalog"
  if [ -d "$STATE/catalog.prev" ]; then mv "$STATE/catalog.prev" "$STATE/catalog"; fi
  if [ -f "$OLD_UNIT" ]; then
    as_mirror MIRROR_INDEX="$STAGE/episodes.json" node "$STAGE/migrate.mjs" --reverse
    systemctl start highdesert-mirror
  fi
  exit 1
fi
rm -rf "$NGX.next"
log "nginx: mirror includes and vhost installed, reloaded"

# Swap the job code.
rm -rf "$PREV"
if [ -d "$DEST" ]; then mv "$DEST" "$PREV"; fi
mv "$STAGE" "$DEST"

# Units: the warm job stays, the gateway goes.
cp "$ROOT/deploy/highdesert-mirror-warm.service" "$ROOT/deploy/highdesert-mirror-warm.timer" /etc/systemd/system/
if [ -f "$OLD_UNIT" ]; then
  systemctl disable highdesert-mirror >/dev/null 2>&1 || true
  rm -f "$OLD_UNIT"
  log "highdesert-mirror (webtorrent) stopped, disabled and removed"
fi
systemctl daemon-reload
systemctl reset-failed highdesert-mirror >/dev/null 2>&1 || true
systemctl enable --now highdesert-mirror-warm.timer >/dev/null 2>&1

# Nothing listens for BitTorrent any more.
for p in "${TORRENT_PORTS[@]}"; do ufw delete allow "$p" >/dev/null 2>&1 || true; done

if ! verify; then
  log "verification failed — rolling back"
  rollback || true
  exit 1
fi
log "deployed $(cat "$DEST/COMMIT")"
