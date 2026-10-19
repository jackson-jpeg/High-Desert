# Handoff: all-time visitors and visitor locations (2026-10-19)

Branch `claude/visitors-geo`. **Not deployed.** This session ran in a Claude
Code cloud container, not on the VPS: there was no SSH to the box, so no
production database, no nginx logs, no deploy and no way to reach the Mac.
What follows was built and tested against a local Postgres 16 and the real
DB-IP file; production numbers come from the public API.

## 1. Audit: what we already store

Full table in `docs/visitors.md`, "What we had before". In short:

- **`/api/stats/funnel` is `funnel_daily`**: counters per (cohort day, device,
  step, look, again). **No id of any kind is stored**: the browser remembers
  "already counted" in localStorage `hd-funnel`. A `visit` is a browser's
  **first** arrival, counted once ever on its UTC cohort day. So it counts
  **unique new browsers, not repeat visits**. Since 2026-10-12 a second look
  adds an `again = true` row, which the totals leave out. Browsers that arrived
  with a library already in them (people who were here before 2026-09-27) are
  excluded for good and appear in no count.
- **Heartbeat/presence** (`active_sessions`): random per-page-load session ids
  and a `client_ref` HMAC whose salt lives only in the running process, rows
  deleted 5 minutes after the tab closes. Nothing survives to backfill from.
  `listener_samples`/`traffic_daily` hold *concurrent* counts (and `online`
  counted page loads until 2026-09-24), not distinct visitors.
- **nginx** logs to `/var/log/nginx/highdesert.access.log` (vhost line 83,
  combined format). I could not read it. With Ubuntu's default logrotate (daily,
  14 kept) it reaches back to about 2026-10-05, after the funnel started. Even
  with older logs, an address is not a browser and cannot be matched to a funnel
  arrival, so logs cannot be added to the count honestly.
  `scripts/audit-access-logs.mjs` reports the window, distinct clients per day
  and (`--geo`) places, writing nothing. **Run it on the VPS to confirm the
  window.**

**Earliest day we can honestly count from: 2026-09-27** (the first funnel
cohort). Production, from the public API on 2026-10-19: 1,158 new browsers
since then (771 phone, 387 desktop), 114 seen again on a later day.

## 2. The `visitors` table and backfill

One row per browser, keyed by a random id the browser keeps (localStorage
`hd-visitor`): `first_seen`, `last_seen`, `first_day`, `last_day`,
`visit_days`, `device`, `look`, `country`, `region`, plus `origin`,
`here_before` and the browser's funnel arrival. **No address is stored
anywhere**; `country` has a CHECK for two capital letters.

Backfill: every funnel arrival becomes a placeholder row (`origin = 'funnel'`,
no location). When a browser posts its own funnel arrival, **one placeholder
for that day and device is deleted in the same transaction**, so the total
does not move and nobody is counted twice. The 2-minute sample timer
reconciles the placeholders against the funnel (idempotent). So at deploy the
all-time count starts at the funnel's 1,158 (plus today's), and as people come
back their placeholders turn into real rows with locations.

Browsers from before 2026-09-27 are counted when they come back
(`hereBefore`). Ones that never come back can't be counted. The page should
say "counting since 27 September 2026".

## 3. Location

- `src/lib/geo/geoip.ts`: **DB-IP IP to City Lite** MMDB on the box
  (`/var/lib/highdesert-geoip/city.mmdb`), read with `mmdb-lib` (new
  dependency, pinned 3.0.3). It resolves country and state at request time on
  the visitor post and on every heartbeat. GeoLite2 City also works if you put
  `GEOIP_MAXMIND_LICENSE_KEY` in `/root/.high-desert.env`.
- **City-level: not reliable with DB-IP Lite, so it is off.** DB-IP gives no
  accuracy radius. Cities are kept only when the database reports one of
  50 km or less, which GeoLite2 does. In testing DB-IP placed 8.8.8.8 in
  California and a Comcast address in Rohnert Park. The feed is state-level.
- Monthly refresh: `highdesert-geoip.timer` (the 4th, 04:40 UTC) runs
  `scripts/update-geoip.mjs`. It checks the file before renaming it into place,
  and on failure keeps the old file. I tested it for real here: it fetched the
  2026-10 file (127 MB, built 2026-10-01).
- **Licence: DB-IP is CC BY 4.0.** The page must show "IP Geolocation by
  DB-IP" linking to db-ip.com. Every new API response carries `attribution`.
- **Memory:** the 127 MB file is loaded into the app process (`MemoryMax` is
  1200M). Watch `highdesert-status`'s `memory` line after deploy.

## 4. Endpoints

- `POST /api/stats/visitor`: the browser's visit (once per page load, from
  `UsageTracker`). Robots and more than 30 new ids per client per hour are
  accepted but not counted.
- `GET /api/stats/visitors`: `countingSince`, totals, and by country and US
  state for `allTime`, `week` and `now`.
- `GET /api/stats/tuning-in`: the last 10 tune-ins to the station, state-level,
  one per client per half hour, kept 7 days.
- `GET /api/stats/records`: biggest crowd (from 2026-09-24, when `online`
  started counting people; currently 38 online at 2026-09-27 03:20 UTC per
  `/api/stats/traffic`), biggest day by plays, biggest arrival day (2026-09-27,
  286 new browsers), and most played (2003-05-29 Cosmology & Consciousness,
  Adair Butchins, 278 plays).

Shapes are in CLAUDE.md's API table and `docs/visitors.md`.

## 5. Tests and checks run here

- New: `visitor-backfill.test.ts` (pure planner, including the invariant on
  production funnel numbers), `visitors.db.test.ts` (12 tests against real
  Postgres: one row per browser, visit days, backfill, claim, reconcile trim,
  here-before, locations, tune-in detection, feed, records), `geoip.test.ts`
  (plus a real-file block with `GEOIP_TEST_DB`), `visitor-client.test.ts`,
  `visitor-route.test.ts`, `heartbeat-geo.test.ts`,
  `audit-access-logs.test.ts`, and the sample route's maintenance test.
- 15 new mutations in `scripts/mutate-check.mjs`, all red. The first run had
  two survivors: a dead line, now removed, and an untested trim path, now
  tested.
- `npm run lint` (one existing warning), `npm run typecheck`, and a production
  `npm run build` all pass. I also ran a smoke test of the built server on a
  local DB with the real geo file: a claim turned 295 placeholders into 294
  plus a real row, a Googlebot UA wasn't counted, a heartbeat tune-in landed
  in the feed as Michigan.
- In the full suite, `scripts/__tests__/deploy.test.ts` (one case),
  `e2e-tokens.test.ts` and `services/live/test/*` fail here. They also fail on
  an unchanged `main` in this container (the chat service's dependencies aren't
  installed; `deploy.test` exits 127). **Re-run them on the VPS.**
- Not run: `check:csp`, `check:seo` and e2e (no running production-like
  server with the e2e database here).

## To ship (on the VPS)

```bash
cd /root/High-Desert && git fetch origin && git checkout claude/visitors-geo   # or merge to main first
set -a; . /root/.high-desert-test.env; set +a
npm run lint && npm run typecheck && npm run test                              # in a worktree for mutations
node scripts/mutate-check.mjs visitor && node scripts/mutate-check.mjs geoip && node scripts/mutate-check.mjs sample-visitors
bash scripts/deploy.sh                       # lockfile + schema change; deploy installs and applies both
bash scripts/geoip-setup.sh                  # timer + first download
node scripts/audit-access-logs.mjs --geo     # what the logs cover
# verify against production, within 2 minutes of the first sample:
curl -s https://highdesert.space/api/stats/visitors | jq '.countingSince, .totals'
#   expect countingSince "2026-09-27", backfilled ≈ funnel totals.visit (1,158 on 10-19, plus new arrivals)
curl -s 'https://highdesert.space/api/stats/funnel?days=90' | jq .totals.visit
curl -s https://highdesert.space/api/stats/records | jq
curl -s https://highdesert.space/api/stats/tuning-in | jq
npm run check:csp -- https://highdesert.space && npm run check:seo -- https://highdesert.space
scp docs/visitors-2026-10-19/handoff.md macbook:~/Downloads/   # the copy this session could not make
```

Check: `totals.visitors` should equal funnel `totals.visit` plus the
`hereBefore` browsers and plus browsers with no funnel arrival (show-page-only
visitors). `backfilled + browsers` with a cohort should equal the funnel's
visits.

## Design calls worth a second look

- **This adds a persistent per-browser id.** That is a first for the site:
  `funnel_daily` and `docs/usage-tracking.md` say "no browser id", and the
  chat docs say "never add IP geolocation" (that was about suggesting a caller's
  place). You asked for both, so I built them with no addresses stored and the
  geo data self-hosted. The privacy note on the site may need updating.
- "All time" uses each browser's **latest** location, not its first.
- The `visit_days` of returning placeholders is an estimate scaled from the
  funnel's `return` step. It never changes the visitor count.
- Not added: a `geoip` line in `highdesert-status`
  (`/var/lib/highdesert-geoip/status.json` is ready for one), and the stats
  page UI itself.
