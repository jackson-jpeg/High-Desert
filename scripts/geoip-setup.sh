#!/usr/bin/env bash
# Install the monthly geo database refresh and fetch the first file
# (docs/visitors.md, "Location"). Idempotent. Run as root on the VPS:
#   bash scripts/geoip-setup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cp "$ROOT/deploy/highdesert-geoip.service" "$ROOT/deploy/highdesert-geoip.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now highdesert-geoip.timer >/dev/null
systemctl start highdesert-geoip.service
GEOIP_DB=/var/lib/highdesert-geoip/city.mmdb node "$ROOT/scripts/update-geoip.mjs" --check
systemctl list-timers highdesert-geoip.timer --no-pager
