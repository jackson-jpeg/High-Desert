#!/usr/bin/env bash
#
# Nightly backup of the `highdesert` Postgres database (HD-006).
#
# `play_events` and `traffic_daily` are the permanent record — never pruned, and
# the only copy of years of listening history. Before this existed nothing
# dumped them anywhere: a disk failure or a bad `schema.sql` run would have
# lost them outright.
#
# What a run does:
#   1. pg_dump -Fc into $BACKUP_DIR, via a .partial file renamed only once
#      pg_restore can read its table of contents back — an unreadable dump is
#      a file, not a backup.
#   2. Deletes dumps older than $RETENTION_DAYS, but never the newest one.
#   3. Copies the directory to the MacBook over Tailscale (rsync --delete, so
#      the Mac mirrors the same retention). Skipped, with a logged warning, if
#      the Mac is unreachable or lacks room for this dump plus
#      $MAC_HEADROOM_MB. The Mac's disk is permanently tight — that is the
#      environment, not a fault — so the floor is sized to what is actually
#      being written rather than a fixed number of gigabytes. The Mac is
#      the off-box copy, and it is often asleep: an unreachable Mac is a warning,
#      not a failure. The next run carries everything across.
#   4. Writes $STATUS_FILE on every run, success or failure. A run that never
#      happened cannot log its own absence, so `highdesert-backup-status`
#      reports STALE when the newest dump is older than 36h.
#
# Installed as highdesert-backup.{service,timer} (deploy/). Run by hand:
#   systemctl start highdesert-backup.service
#
# Everything is overridable for scripts/__tests__/backup-db.test.ts:
#   DATABASE_URL            database to dump (from /root/.high-desert.env)
#   HD_BACKUP_DIR           /root/backups/highdesert
#   HD_BACKUP_STATUS        /var/lib/highdesert-backup/STATUS
#   HD_BACKUP_LOG           /var/log/highdesert-backup.log
#   HD_BACKUP_RETENTION     14 (days)
#   HD_BACKUP_MAC_HOST      macbook (Tailscale ssh alias; "" disables the Mac leg)
#   HD_BACKUP_MAC_DEST      /Users/jackson/Downloads/highdesert-db-backups
#   HD_BACKUP_MAC_MIN_MB    5120
#   HD_BACKUP_SSH           ssh
#   HD_BACKUP_RSYNC         rsync
#
set -uo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set — run via highdesert-backup.service, which loads /root/.high-desert.env}"

BACKUP_DIR="${HD_BACKUP_DIR:-/root/backups/highdesert}"
STATUS_FILE="${HD_BACKUP_STATUS:-/var/lib/highdesert-backup/STATUS}"
LOG_FILE="${HD_BACKUP_LOG:-/var/log/highdesert-backup.log}"
RETENTION_DAYS="${HD_BACKUP_RETENTION:-14}"
MAC_HOST="${HD_BACKUP_MAC_HOST-macbook}"
MAC_DEST="${HD_BACKUP_MAC_DEST:-/Users/jackson/Downloads/highdesert-db-backups}"
MAC_HEADROOM_MB="${HD_BACKUP_MAC_HEADROOM_MB:-500}"
SSH="${HD_BACKUP_SSH:-ssh}"
RSYNC="${HD_BACKUP_RSYNC:-rsync}"

umask 077
mkdir -p "$BACKUP_DIR" "$(dirname "$STATUS_FILE")" "$(dirname "$LOG_FILE")"
chmod 700 "$BACKUP_DIR"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG_FILE"; }

# Carry the last successful Mac copy forward, so the status file can say how
# old the off-box copy is even on a night the Mac was asleep.
prev_mac_ok_epoch="$(sed -n 's/^mac_last_ok_epoch=//p' "$STATUS_FILE" 2>/dev/null || true)"

result=OK
detail=""
dump_file=""
dump_bytes=0
mac_result=""

write_status() {
  local newest newest_epoch=0
  newest="$(ls -1t "$BACKUP_DIR"/highdesert-*.dump 2>/dev/null | head -1 || true)"
  [[ -n "$newest" ]] && newest_epoch="$(stat -c %Y "$newest")"
  local tmp="$STATUS_FILE.tmp"
  {
    echo "generated=$(date -u +%FT%TZ)"
    echo "generated_epoch=$(date +%s)"
    echo "result=$result"
    echo "detail=$detail"
    echo "dump_file=$dump_file"
    echo "dump_bytes=$dump_bytes"
    echo "newest_dump=$newest"
    echo "newest_dump_epoch=$newest_epoch"
    echo "dumps_kept=$(ls -1 "$BACKUP_DIR"/highdesert-*.dump 2>/dev/null | wc -l)"
    echo "mac_result=$mac_result"
    echo "mac_last_ok_epoch=${prev_mac_ok_epoch:-0}"
  } > "$tmp"
  mv "$tmp" "$STATUS_FILE"
}

# ---------------------------------------------------------------------------
# 1. Dump
# ---------------------------------------------------------------------------
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$BACKUP_DIR/highdesert-$stamp.dump"
partial="$dump_file.partial"

log "START dump -> $dump_file"
if ! pg_dump "$DATABASE_URL" --format=custom --file="$partial" 2>>"$LOG_FILE"; then
  rm -f "$partial"
  result=FAILED
  detail="pg_dump failed (see $LOG_FILE)"
  dump_file=""
  log "FAIL pg_dump"
  write_status
  exit 1
fi

# The dump must be readable back, and must actually contain the permanent
# tables. A dump of the wrong database, or of one where the schema was never
# applied, would otherwise pass as a backup.
toc="$(pg_restore --list "$partial" 2>>"$LOG_FILE" || true)"
missing=""
for table in play_events traffic_daily; do
  grep -qE "TABLE DATA public $table " <<<"$toc" || missing+=" $table"
done
if [[ -z "$toc" || -n "$missing" ]]; then
  rm -f "$partial"
  result=FAILED
  detail="dump unreadable or missing tables:${missing:- (empty table of contents)}"
  dump_file=""
  log "FAIL verify — $detail"
  write_status
  exit 1
fi

mv "$partial" "$dump_file"
dump_bytes="$(stat -c %s "$dump_file")"
sha256sum "$dump_file" | cut -d' ' -f1 > "$dump_file.sha256"
log "OK dump ${dump_bytes} bytes, sha256 $(cat "$dump_file.sha256")"

# ---------------------------------------------------------------------------
# 2. Retention — by age, never the newest.
# ---------------------------------------------------------------------------
newest="$(ls -1t "$BACKUP_DIR"/highdesert-*.dump | head -1)"
while IFS= read -r old; do
  [[ -z "$old" || "$old" == "$newest" ]] && continue
  rm -f "$old" "$old.sha256"
  log "PRUNE $(basename "$old")"
done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'highdesert-*.dump' -mtime "+$((RETENTION_DAYS - 1))")
rm -f "$BACKUP_DIR"/*.partial

# ---------------------------------------------------------------------------
# 3. Off-box copy to the Mac
# ---------------------------------------------------------------------------
if [[ -z "$MAC_HOST" ]]; then
  mac_result="disabled"
else
  free_mb="$("$SSH" -o ConnectTimeout=20 -o BatchMode=yes "$MAC_HOST" \
    "df -m / | awk 'NR==2 {print \$4}'" 2>/dev/null | tr -cd '0-9' || true)"
  if [[ -z "$free_mb" ]]; then
    mac_result="skipped: Mac unreachable or free space unreadable"
    log "WARN $mac_result — dump kept on the VPS only; the next run will copy it"
  elif need_mb=$(( (dump_bytes + 1048575) / 1048576 + MAC_HEADROOM_MB )); (( free_mb < need_mb )); then
    mac_result="skipped: Mac has ${free_mb}MB free, needs ${need_mb}MB (dump + ${MAC_HEADROOM_MB}MB)"
    log "WARN $mac_result — dump kept on the VPS only; the next run will copy it"
  elif "$SSH" -o ConnectTimeout=20 -o BatchMode=yes "$MAC_HOST" "mkdir -p '$MAC_DEST'" >/dev/null 2>&1 \
    && "$RSYNC" -a --delete --timeout=300 "$BACKUP_DIR/" "$MAC_HOST:$MAC_DEST/" 2>>"$LOG_FILE"; then
    mac_result="ok (${free_mb}MB free)"
    prev_mac_ok_epoch="$(date +%s)"
    log "OK copied to $MAC_HOST:$MAC_DEST"
  else
    mac_result="skipped: rsync to $MAC_HOST failed"
    log "WARN $mac_result — dump kept on the VPS only"
  fi
fi

detail="$(basename "$dump_file") ${dump_bytes}B; mac: $mac_result"
write_status
log "DONE $detail"
exit 0
