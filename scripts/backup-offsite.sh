#!/usr/bin/env bash
#
# The encrypted off-box copy of the High Desert database (2026-10-11).
#
# The Mac copy (backup-db.sh, leg 3) is often asleep, and it is the only copy
# off this box. This is the second: every dump the VPS keeps, encrypted with
# age to a public key whose private half is NOT on GitHub, published to the
# private repo jackson-jpeg/highdesert-backups.
#
# What a run does:
#   1. Encrypts each highdesert-*.dump in $BACKUP_DIR that has no .age copy yet
#      (an existing copy is kept as is: age output differs every run, and
#      re-encrypting would rewrite every file every night). Copies whose dump
#      backup-db.sh has pruned go too, so the repo holds what the VPS holds:
#      $RETENTION days.
#   2. Restore test, every run, when the identity is on this box: decrypts the
#      newest copy and requires its sha256 to equal the dump's, and pg_restore
#      to read its table of contents with the permanent tables in it.
#   3. Publishes the set as ONE orphan commit, force-pushed to main. History is
#      not kept on purpose: a plain commit per night would keep every dump in
#      the repo forever, and "14 days kept" would be false.
#
# Prints one line, "offsite: ok ..." or "offsite: skipped ...", and exits
# non-zero only on a failure that needs a person (a copy that does not decrypt
# to its dump, a push refused). backup-db.sh records the line in its status.
#
#   HD_BACKUP_DIR             /root/backups/highdesert
#   HD_OFFSITE_RECIPIENT      deploy/backup-age-recipient.txt (the public key, committed)
#   HD_OFFSITE_IDENTITY       /root/.high-desert-backup-age.key (chmod 600; "" skips the restore test)
#   HD_OFFSITE_REMOTE         https://github.com/jackson-jpeg/highdesert-backups.git ("" disables)
#   HD_OFFSITE_WORK           /var/lib/highdesert-backup/offsite
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${HD_BACKUP_DIR:-/root/backups/highdesert}"
RECIPIENT="${HD_OFFSITE_RECIPIENT:-$ROOT/deploy/backup-age-recipient.txt}"
IDENTITY="${HD_OFFSITE_IDENTITY-/root/.high-desert-backup-age.key}"
REMOTE="${HD_OFFSITE_REMOTE-https://github.com/jackson-jpeg/highdesert-backups.git}"
WORK="${HD_OFFSITE_WORK:-/var/lib/highdesert-backup/offsite}"

# Never let a caller's git variables point this at another repository
# (CLAUDE.md, "No git hooks in production trees").
while IFS= read -r v; do unset "$v"; done < <(env | sed -n 's/^\(GIT_[A-Za-z_]*\)=.*/\1/p')

if [[ -z "$REMOTE" ]]; then
  echo "offsite: disabled"
  exit 0
fi
if ! command -v age >/dev/null; then
  echo "offsite: skipped: age is not installed"
  exit 1
fi
if [[ ! -s "$RECIPIENT" ]]; then
  echo "offsite: skipped: no recipient key at $RECIPIENT"
  exit 1
fi

umask 077
files="$WORK/files"
mkdir -p "$files"

# 1. Encrypt what is new; drop what the VPS no longer keeps.
added=0
for dump in "$BACKUP_DIR"/highdesert-*.dump; do
  [[ -e "$dump" ]] || continue
  name="$(basename "$dump")"
  if [[ ! -s "$files/$name.age" ]]; then
    if ! age -R "$RECIPIENT" -o "$files/$name.age.partial" "$dump"; then
      rm -f "$files/$name.age.partial"
      echo "offsite: failed: age could not encrypt $name"
      exit 1
    fi
    mv "$files/$name.age.partial" "$files/$name.age"
    added=$((added + 1))
  fi
  sha256sum "$dump" | cut -d' ' -f1 > "$files/$name.sha256"
done
dropped=0
for enc in "$files"/highdesert-*.dump.age; do
  [[ -e "$enc" ]] || continue
  name="$(basename "$enc" .age)"
  if [[ ! -e "$BACKUP_DIR/$name" ]]; then
    rm -f "$enc" "$files/$name.sha256"
    dropped=$((dropped + 1))
  fi
done
rm -f "$files"/*.partial
kept="$(ls -1 "$files"/*.dump.age 2>/dev/null | wc -l)"
if (( kept == 0 )); then
  echo "offsite: skipped: no dump to copy in $BACKUP_DIR"
  exit 1
fi

# 2. Restore test of the newest copy.
restore="not tested (no identity on this box)"
if [[ -n "$IDENTITY" && -s "$IDENTITY" ]]; then
  newest="$(ls -1 "$files"/highdesert-*.dump.age | sort | tail -1)"
  name="$(basename "$newest" .age)"
  plain="$WORK/restore-test.dump"
  if ! age -d -i "$IDENTITY" -o "$plain" "$newest"; then
    rm -f "$plain"
    echo "offsite: failed: $name.age does not decrypt with $IDENTITY"
    exit 1
  fi
  if [[ "$(sha256sum "$plain" | cut -d' ' -f1)" != "$(cat "$files/$name.sha256")" ]]; then
    rm -f "$plain"
    echo "offsite: failed: $name.age decrypts to different bytes than the dump"
    exit 1
  fi
  toc="$(pg_restore --list "$plain" 2>/dev/null || true)"
  rm -f "$plain"
  for table in play_events traffic_daily; do
    if ! grep -qE "TABLE DATA public $table " <<<"$toc"; then
      echo "offsite: failed: $name.age decrypts, but pg_restore finds no $table in it"
      exit 1
    fi
  done
  restore="restore test ok ($name)"
fi

# 3. One orphan commit of exactly this set, force-pushed.
repo="$WORK/repo"
rm -rf "$repo"
mkdir -p "$repo"
cp "$files"/* "$repo"/
cat > "$repo/README.md" <<'EOF'
# highdesert-backups

Nightly `pg_dump -Fc` of High Desert's `highdesert` database, encrypted with
[age](https://age-encryption.org) to the key in High-Desert's
`deploy/backup-age-recipient.txt`. The private key is not here. The last 14
days only: each night replaces the whole history with one commit.

Restore: `age -d -i <key> -o db.dump highdesert-<stamp>.dump.age`, check it
against `highdesert-<stamp>.dump.sha256`, then `pg_restore` as in
High-Desert's `docs/backup.md`.
EOF
(
  cd "$repo" &&
    git init -q -b main &&
    git -c user.name="High Desert backup" -c user.email="backup@highdesert.space" add -A &&
    git -c user.name="High Desert backup" -c user.email="backup@highdesert.space" commit -q -m "highdesert backups: $kept nightly dumps, encrypted" &&
    git push -q --force "$REMOTE" HEAD:main
) >"$WORK/push.log" 2>&1
pushed=$?
rm -rf "$repo"
if (( pushed != 0 )); then
  echo "offsite: failed: push to $REMOTE refused ($(tail -1 "$WORK/push.log"))"
  exit 1
fi
echo "offsite: ok, $kept kept ($added new, $dropped dropped), $restore"
exit 0
