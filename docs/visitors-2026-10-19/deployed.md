# Deployed: all-time visitors and visitor locations (2026-10-20)

PRs #79 and #81 (8a3b321, 82d85d0) are live as **f0f2917**, deployed
2026-10-20 18:52 UTC with `scripts/deploy.sh`. The deploy was outside the
04:30 Eastern window; Jackson okayed it in the session. A "From the station"
notice went into the phone lines first.

## Checks (worktree `/root/hd-visitors`, detached at main, everything through `heavy`)

- `npm run lint`: pass (the one existing warning, `_onTheHour`).
- `npm run typecheck`: pass.
- `npm run test` first run: 22 failed in 15 files. **Not this change, and not the cloud
  container's reasons either:**
  - `highdesert_test` had not had the new schema applied (`relation "visitors" does not
    exist`, `column "country" of relation "active_sessions" does not exist`).
    `scripts/schema.sql` was applied to it (idempotent).
  - `services/live/test/*` and `e2e-tokens.test.ts`: the worktree had no
    `services/live/node_modules` (`Cannot find package 'obscenity'`). `npm ci` there.

  Re-run of all 15 files: 286 passed. `deploy.test.ts` passed on the first run.
- Mutations: `visitor` 15, `geoip` 1, `sample-visitors` 1, `listeners-` 6: **all 23 red**,
  none NOT CHECKED.
- `npm run build` in the worktree: pass. Served on 127.0.0.1:3213 against `highdesert_e2e`
  (schema applied there too). `check:seo`: no findings. `check:csp`: `/stats` and everything
  else clean, except 5 console 404s on `/live` and `/request-line`. Those were
  `/live-api/*`, which nginx routes to the chat service and a bare `next start` cannot
  serve. On production, through nginx, both pages are clean (below).

## Deploy and geo

- `deploy.sh`: schema applied, `mmdb-lib` installed in staging, client verified, the
  returning visitor ok in Chromium and WebKit (Library 0.8 s, Stats 1.4 / 0.9 s).
- `geoip-setup.sh`: timer installed (next run 2026-11-04 04:48 UTC), file
  `/var/lib/highdesert-geoip/city.mmdb` = DBIP-City-Lite built 2026-10-01, 127 MB.
  The app picks up the file on its 10-minute re-check, no restart: heartbeats carried
  places from about 19:02 UTC.
- Memory: `highdesert-status` 56.4% available (59.6% before), the app at 561 MB of its
  1200 MB `MemoryMax`.

## Production numbers (19:07 UTC)

- `/api/stats/visitors`: `countingSince` **"2026-09-27"**; totals: visitors 1,206,
  browsers 13, backfilled 1,193, hereBefore 4, newThisWeek 212, activeThisWeek 221,
  returning 138. Attribution "IP Geolocation by DB-IP".
- Funnel `totals.visit` (90 days): **1,202**. Backfilled + browsers with a cohort =
  1,193 + 9 = 1,202. **Holds.** Also checked in the database:
  placeholders + browsers with `funnel_cohort` equalled `funnel_daily` visits.
- The first reconcile ran on the 18:54 sample (the 18:52 one was around the restart).
- `/api/stats/records`: biggest crowd 38 online / 24 listening (2026-09-27 03:20 UTC),
  biggest day 567 plays (2026-09-27), biggest arrival day 286 (2026-09-27), most played
  Cosmology and Consciousness, 278 plays.
- `/api/stats/tuning-in`: entries arriving state-level (Arizona, Munster), no city.
- `active_sessions` by place at 19:05: 19 sessions, all placed: US 12 (California 3,
  North Carolina 2, one each in FL, WA, CO, VA, NV, AZ, NY), CA, GB, IE, CY, ZA, PY.
- `/stats` Listeners panel, Win98 and Night, 390 px and 1280 px: renders, no page
  errors, no horizontal overflow, no em dash, the DB-IP credit present. The all-time map
  is mostly "not placed" until people come back (1,205 of 1,206 at deploy).
- `check:csp` on production: 8 routes, no violations, no console errors, no em dashes.
  `check:seo` on production: no findings.

## Something off, fixed

`highdesert-status`'s **presence line FAILed** after the deploy: "listeners displays
[18] but is tagged 18/9". The Listeners panel shows the online count alone, like the
Stats badge, and the component test already says so. But `scripts/presence-check.mjs`'s
`ONLINE_ONLY` set did not include it. Fixed in **29afa7e**: added to the set, a test
case, and mutation `presence-check-listeners-online-only` (red). The status line reads
OK again. A script-only change, so no deploy was needed.

## nginx logs (`node scripts/audit-access-logs.mjs --geo`)

15 files, logrotate daily with 14 kept, so the window is **2026-10-06 to 2026-10-20**.
That is nine days after the funnel's first cohort; nothing older exists. 43,233 page loads
by people, 1,292 distinct clients (addresses, not browsers), 99 to 197 a day. Countries:
US 974, CA 93, GB 34, AU 30, IE 23, BM 16, then a long tail. Top states: California 148,
Florida 104, Michigan 69, New York 48.

## Left as it was

- Worktree `/root/hd-visitors` removed at session end; the e2e and test databases keep
  the new schema (as they should).
- Not added (from the handoff): a `geoip` line in `highdesert-status`
  (`/var/lib/highdesert-geoip/status.json` is ready for it). The privacy note on the site
  still needs a look, since the site now keeps a per-browser id.
- No hook blocked anything this session. The pipefail hook prefixed commands as usual.

## Follow-ups, deployed as 1faf0f4 (2026-10-20 19:39 UTC)

- **`geoip` line in `highdesert-status`** (bd235b4): OK when `city.mmdb` is there and
  was built within 45 days; WARN past 45 days or when the last refresh failed; FAIL
  when the file is missing or older than 75 days. `update-geoip.mjs` used to write no
  build date after a failed refresh, so it now carries the serving file forward as
  `installed` (`failedStatus`). Tests in `status.test.ts` and `update-geoip.test.ts`;
  mutations `status-geoip-*` and `update-geoip-failed-keeps-installed`, all red. Reads
  OK on production: DBIP-City-Lite built 2026-10-01 (19 days).
- **Privacy wording** (a97e9ce), as approved: a Privacy paragraph in the About dialog
  (held by `about-dialog.test.tsx`, mutation `about-privacy-paragraph`), the Listeners
  footer, `docs/usage-tracking.md` and `docs/funnel.md`.
- **Listeners panel** (ba8a8a5): "N of M placed so far. The map fills in as listeners
  come back." under the map while under 90% of the period is placed (never on Right
  now), and the panel opens where the data is (`defaultPeriod`). It is chosen once when
  the numbers arrive, then only by a click. Six new mutations, all red; the existing
  `listeners-period-switch` was re-anchored (1faf0f4) after its line changed.
  On production at 19:40 it opens on Right now in both looks, at phone and desktop width.
  All time reads "9 of 1,207 placed so far.", with no errors and no overflow.
- Checks before the deploy (worktree, through `heavy`): lint (the usual one warning),
  typecheck, the full suite 307 files / 2,950 tests passed, a build. `check:seo` was
  clean locally; `check:csp` had only the `/live-api` 404s a bare `next start` gives.
  After the deploy, both were clean on production.
- `highdesert-status` after the deploy: every line OK except `backup`'s WARN that
  the Mac copy was skipped (the Mac was unreachable at 17:30).
- **A hook block:** the npm hook (`block-npm-in-prod.py`) refused
  `cd ../hd-geoip && ... ; (cd services/live && npm ci)`. It was right: after the
  `;`, the second `npm ci` could have run from production's `services/live`. Nothing
  ran. I redid it with absolute worktree paths joined by `&&`, as the block message
  says.
