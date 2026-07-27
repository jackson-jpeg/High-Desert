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
