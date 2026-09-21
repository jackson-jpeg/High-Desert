# Database backup (HD-006)

`play_events` and `traffic_daily` are the permanent record of High Desert. They
are never pruned, and they are the only copy of the listening history. Until
2026-09-21 nothing dumped them anywhere.

## What runs

| Piece | Where |
|---|---|
| Backup script | `scripts/backup-db.sh` |
| Units (versioned) | `deploy/highdesert-backup.{service,timer}`, installed in `/etc/systemd/system/` |
| Schedule | daily, **17:30 UTC**, `Persistent=true` |
| Local dumps | `/root/backups/highdesert/highdesert-<UTC stamp>.dump` (+ `.sha256`), mode 700, **14-day retention** |
| Off-box copy | `macbook:~/Downloads/highdesert-db-backups/` over Tailscale, `rsync --delete` (mirrors the retention) |
| Status file | `/var/lib/highdesert-backup/STATUS` |
| Log | `/var/log/highdesert-backup.log` and `journalctl -u highdesert-backup` |
| Status check | `highdesert-backup-status` (→ `scripts/backup-status.sh`): OK / FAILED / **STALE after 36h** |

**Why 17:30 UTC rather than overnight.** The dump itself could run at any hour,
but the off-box copy needs the MacBook awake. The reverse tunnel is up about 85%
of the 17:00 UTC hour and about 50% of the 03:00 UTC hour (`/root/CLAUDE.md`).
The job runs 15 minutes after `repo-bundle` so the two do not share the Mac link.

**A run:**

1. Writes the dump to a `.partial` file with `pg_dump -Fc`.
2. Reads the table of contents back with `pg_restore --list`, and requires that
   `play_events` and `traffic_daily` data are present. Only then is the file
   renamed to `.dump`.
3. Deletes dumps older than 14 days, but never the newest.
4. Copies the directory to the Mac. The copy is skipped, with a `WARN` line, if
   the Mac is unreachable or has less than **5 GB** free. That is the same floor
   `repo-bundle` uses. An unreachable Mac is a warning, not a failure: the dump
   stays on the VPS and the next run carries it across.

`highdesert-backup-status` reads the dump file's own mtime rather than the
status file. A status file left behind by a run that produced no dump therefore
cannot pass as fresh.

## Restore

```bash
sudo -u postgres createdb highdesert_restore
sudo -u postgres pg_restore --no-owner --no-privileges --exit-on-error \
  -d highdesert_restore < /root/backups/highdesert/highdesert-<stamp>.dump
```

To restore over production, stop `highdesert` and `highdesert-sample.timer`
first. Then `pg_restore --clean --if-exists` into `highdesert`, or restore into a
new database and repoint `DATABASE_URL` in `/root/.high-desert.env`.

## Restore rehearsal, 2026-09-21

The timer had not fired yet, so there was no "last night's" dump. The first dump
was taken by hand (`systemctl start highdesert-backup.service`) at 14:05:40 UTC
and restored immediately:

```
dump      highdesert-20260921T140540Z.dump   295,335 bytes
sha256    c24259febd680d8b3f380d6f91900cd391466a50daee47693b830c72843fb61a
          (identical on the VPS and in macbook:~/Downloads/highdesert-db-backups/)
restore   sudo -u postgres createdb highdesert_restore_test
          pg_restore --no-owner --no-privileges --exit-on-error  → exit 0
```

| Table | Live | Restored |
|---|---|---|
| **play_events** | **2,055** | **2,055** |
| **traffic_daily** | **57** | **57** |
| listener_samples | 39,903 | 39,903 |
| episode_plays | 1,127 | 1,127 |
| weekly_plays | 1,323 | 1,323 |
| playback_failures | 478 | 478 |
| recent_plays | 42 | 42 |
| episode_ratings | 29 | 29 |
| rating_votes | 10 | 10 |
| active_sessions | 8 | 8 |

Every table matched. `play_events` also matched on its upper bound: the restored
`max(id)` was 2056, and live had exactly 2,055 rows with `id <= 2056`. So no
insert fell between the dump and the count. `traffic_daily` ran through
2026-09-21 in both. The scratch database was then dropped
(`dropdb highdesert_restore_test`; verified absent).

## Tests

`scripts/__tests__/backup-db.test.ts` runs the real scripts:

- **Dump round-trip.** pg_dump runs against `TEST_DATABASE_URL`, and the test
  reads the inserted row back out with `pg_restore --data-only`.
- **Retention.** Dumps aged 15 and 20 days are deleted; one aged 10 days is kept.
- **Mac leg.** With stub `ssh`/`rsync`, a Mac with room receives the copy, and a
  Mac with 2,921 MB free is skipped with a warning.
- **Connection failure.** A pg_dump that cannot connect reports FAILED and
  leaves no dump behind.
- **Status script.** It reports OK, STALE (37h, and no dump at all) and FAILED.

Mutations: `backup-retention`, `backup-mac-floor` and `backup-status-stale`.
