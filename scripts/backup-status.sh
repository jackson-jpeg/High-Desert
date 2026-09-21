#!/usr/bin/env bash
#
# Is the High Desert database backup current? Installed on PATH as
# `highdesert-backup-status` (a wrapper in /root/vps-tools/bin).
#
#   OK      the newest dump is under 36h old and the last run succeeded
#   FAILED  the last run ran and reported a failure
#   STALE   the newest dump is older than 36h, or there is none — which is what
#           a MISSED run looks like. A run that never happened cannot log its
#           own absence; the age of the newest dump is the only signal there is.
#
# The age is read from the dump file itself, not from the status file, so a
# status file left behind by a run that wrote no dump cannot pass as fresh.
#
# Exits 0 on OK, 1 otherwise. The Mac (off-box) copy is reported but does not
# change the exit code: the Mac is often asleep, and the VPS copy is the one
# that is always there.
#
#   HD_BACKUP_DIR      /root/backups/highdesert
#   HD_BACKUP_STATUS   /var/lib/highdesert-backup/STATUS
#   HD_BACKUP_MAX_AGE_H 36
set -uo pipefail

BACKUP_DIR="${HD_BACKUP_DIR:-/root/backups/highdesert}"
STATUS_FILE="${HD_BACKUP_STATUS:-/var/lib/highdesert-backup/STATUS}"
MAX_AGE_H="${HD_BACKUP_MAX_AGE_H:-36}"

now=$(date +%s)
newest="$(ls -1t "$BACKUP_DIR"/highdesert-*.dump 2>/dev/null | head -1 || true)"

field() { sed -n "s/^$1=//p" "$STATUS_FILE" 2>/dev/null; }

mac_line() {
  local ok_epoch mac
  ok_epoch="$(field mac_last_ok_epoch)"
  mac="$(field mac_result)"
  # A skipped Mac copy is a WARN, never a failure: the dump is safe on the VPS
  # and the next run with room carries it across.
  if [[ "$mac" == skipped* ]]; then
    echo "WARN  off-box (Mac) copy ${mac}"
  fi
  if [[ -n "$ok_epoch" && "$ok_epoch" != 0 ]]; then
    echo "  off-box (Mac) copy: last succeeded $(( (now - ok_epoch) / 3600 ))h ago; last run: ${mac:-unknown}"
  else
    echo "  off-box (Mac) copy: never succeeded; last run: ${mac:-unknown}"
  fi
}

if [[ -z "$newest" ]]; then
  echo "DB BACKUP STALE — no dump in $BACKUP_DIR."
  echo "  Run: systemctl start highdesert-backup.service"
  exit 1
fi

age_s=$(( now - $(stat -c %Y "$newest") ))
age_h=$(( age_s / 3600 ))

if (( age_s > MAX_AGE_H * 3600 )); then
  echo "DB BACKUP STALE — newest dump $(basename "$newest") is ${age_h}h old (window ${MAX_AGE_H}h)."
  echo "  A missed run writes nothing: timer disabled, box down, or the job died."
  echo "  Check: systemctl status highdesert-backup.timer; tail -20 /var/log/highdesert-backup.log"
  mac_line
  exit 1
fi

if [[ "$(field result)" == "FAILED" ]]; then
  echo "DB BACKUP FAILED — last run $(field generated): $(field detail)"
  echo "  Newest good dump: $(basename "$newest") (${age_h}h old)."
  echo "  Log: tail -20 /var/log/highdesert-backup.log"
  mac_line
  exit 1
fi

echo "DB BACKUP OK — newest dump $(basename "$newest") (${age_h}h old, $(stat -c %s "$newest") bytes, $(ls -1 "$BACKUP_DIR"/highdesert-*.dump | wc -l) kept)."
mac_line
exit 0
