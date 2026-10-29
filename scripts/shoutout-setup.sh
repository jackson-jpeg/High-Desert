#!/usr/bin/env bash
# Install the supporters' shout-out timer (scripts/donor-shoutout.mjs).
# Idempotent. Run as root on the VPS:
#   bash scripts/shoutout-setup.sh          install the timer
#   bash scripts/shoutout-setup.sh --now    install it and post one now
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cp "$ROOT/deploy/highdesert-shoutout.service" "$ROOT/deploy/highdesert-shoutout.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now highdesert-shoutout.timer >/dev/null
if [ "${1:-}" = "--now" ]; then
  mkdir -p /var/lib/highdesert-shoutout
  set -a; . /root/.high-desert-live.env; set +a
  SHOUTOUT_STATE=/var/lib/highdesert-shoutout/state.json node "$ROOT/scripts/donor-shoutout.mjs" --now
fi
systemctl list-timers highdesert-shoutout.timer --no-pager
