# Deployment units

Systemd units for the traffic sampler. The live copies live in
`/etc/systemd/system/`; these are the versioned source.

## Traffic sampler

`highdesert-sample.timer` POSTs `/api/stats/sample` every two minutes. It is the
only writer to the `listener_samples` table, and therefore the only reason any
traffic *history* exists — `active_sessions` is a live set that is pruned as it
is counted, and `episode_plays` carries no timestamps.

A timer rather than sampling lazily on read: sampling on read records nothing
during quiet periods, which makes an empty stretch indistinguishable from a gap
in collection. The timer records the zeroes.

### Install

```bash
sudo cp deploy/highdesert-sample.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now highdesert-sample.timer
```

### Requirements

`/root/.high-desert.env` (chmod 600, referenced via `EnvironmentFile=`) must
contain both:

```
DATABASE_URL=postgres://...
STATS_SAMPLE_SECRET=<random string>
```

The endpoint refuses every request when `STATS_SAMPLE_SECRET` is unset rather
than running unauthenticated — an open write endpoint is worse than a missing
one. Generate one with:

```bash
head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40
```

### Check

```bash
systemctl list-timers highdesert-sample.timer
psql "$DATABASE_URL" -c 'SELECT * FROM listener_samples ORDER BY sampled_at DESC LIMIT 5;'
curl -s 'http://127.0.0.1:3003/api/stats/traffic?range=24h' | jq '{peakOnline, playsInRange, n: (.points|length)}'
```

## Database backup

`highdesert-backup.timer` runs `scripts/backup-db.sh` daily at 17:30 UTC:
pg_dump → `/root/backups/highdesert` (14 days) → MacBook over Tailscale. See
`docs/backup.md`.

```bash
sudo cp deploy/highdesert-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now highdesert-backup.timer
highdesert-backup-status        # OK / FAILED / STALE (>36h)
```

## nginx vhost

`deploy/nginx/highdesert.conf` is the versioned copy of
`/etc/nginx/sites-available/highdesert` (`sites-enabled/highdesert` symlinks
to it). It carries the outer rate limit on the stats **write** routes (HD-007):
`limit_req` on `POST /api/stats/*` and `POST /api/playback-event`, keyed on
`$binary_remote_addr`, 60 r/m with a burst of 30, refused with 429. The zone
and its method map are at the top of the file (http context, like the
`upstream`), so there is no separate include to install.
`scripts/__tests__/nginx-vhost.test.ts` asserts that coverage;
`highdesert-status` WARNs when the installed file differs from this one.

### Install

```bash
sudo cp /etc/nginx/sites-available/highdesert /root/backups/highdesert.vhost.$(date -u +%Y%m%dT%H%M%SZ)
sudo cp deploy/nginx/highdesert.conf /etc/nginx/sites-available/highdesert
sudo nginx -t && sudo systemctl reload nginx
highdesert-status        # nginx line: OK
```

If `nginx -t` fails, restore the backup copy before doing anything else — a
reload is never attempted on a config that did not test clean.

## Rating voter secret (HD-008)

`rating_votes.voter` is `HMAC-SHA256(client, RATING_VOTER_SECRET)` — the client
being the IPv4 address or the IPv6 /64 — never the address itself. Without the
secret `/api/stats/rate` answers 503 and records nothing. Add it to
`/root/.high-desert.env` (chmod 600) **once, and never rotate it casually**:
a new secret makes every existing ballot unmatchable, so each voter's next
rating is counted as a new vote.

```bash
echo "RATING_VOTER_SECRET=$(openssl rand -hex 32)" >> /root/.high-desert.env
```

Existing plaintext rows are converted in place, once, by
`scripts/migrate-hash-voters.mjs` (one transaction, idempotent, merges
collisions keeping the newest vote and backs merged votes out of
`episode_ratings`). Take a dump first:

```bash
set -a; . /root/.high-desert.env; set +a
pg_dump "$DATABASE_URL" -t rating_votes -t episode_ratings -Fc \
  -f /root/backups/highdesert/pre-hd008-$(date -u +%Y%m%dT%H%M%SZ).dump
node scripts/migrate-hash-voters.mjs --dry-run      # counts only, rolled back
node scripts/migrate-hash-voters.mjs
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM rating_votes WHERE voter !~ '^[0-9a-f]{64}\$'"   # 0
```

Node prints a one-line `MODULE_TYPELESS_PACKAGE_JSON` warning because the
script imports `src/lib/utils/client-key.ts` directly (native type stripping);
that is expected and harmless.
