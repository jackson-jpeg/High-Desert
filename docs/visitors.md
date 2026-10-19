# Visitors: the all-time count, and where people are (2026-10-19)

What the stats page redesign reads: unique visitors since a stated day, by
country and US state (all time, this week, right now), a "tuning in from"
feed and the records. Code: `src/services/stats/db/visitors.ts`,
`src/lib/stats/visitor-backfill.ts`, `src/lib/geo/`, `src/services/stats/visitor-client.ts`,
and the routes `/api/stats/visitor`, `/api/stats/visitors`, `/api/stats/tuning-in`,
`/api/stats/records`.

## What we had before (the audit)

| Source | Per person? | Keyed by | Since | Usable for unique visitors? |
|---|---|---|---|---|
| `funnel_daily` | no, counters | nothing stored; the browser keeps "already counted" in localStorage `hd-funnel` | 2026-09-27 | **Yes, as a count.** A `visit` is a browser's *first* arrival, counted once ever, on its UTC cohort day, by device (and look from 2026-10-12; a second look is `again = true`, excluded from totals). Unique browsers, not repeat visits. Browsers that arrived with a library already in them (here before 2026-09-27) are excluded for good, so they are in no count. |
| `active_sessions` | per tab | random per-page-load session id; `client_ref` is an HMAC under a **per-process** salt | live set, rows gone 5 min after the tab closes | No. Nothing survives. |
| `listener_samples` / `traffic_daily` | no | — | samples 90 days; daily rollup forever | No: online *at once*, not distinct. `online` counted page loads until 2026-09-24 and clients after. `traffic_daily.sessions` is distinct page loads per day. |
| `play_events.session_ref` | per page load | per-page-load id, NULLed at 90 days | 2026-07-28 | No: a page load, not a person. |
| `arrival_daily`, `route_daily` | no | — | 2026-10-12 | No: per browser *session* (sessionStorage), repeats count. |
| nginx `highdesert.access.log*` | per request | the address | logrotate's window (Ubuntu default 14 days, so about 2026-10-05 today) | No, not honestly: an address is not a browser (households, carrier NAT, phones changing address), and it cannot be matched to a funnel arrival. `scripts/audit-access-logs.mjs` reports what is there (window, distinct clients per day, `--geo` for places) without writing anything. |

**The earliest day we can honestly count from is 2026-09-27**, the first
funnel cohort. Before it no per-browser count exists anywhere, and the logs
do not reach back that far in any case.

Production on 2026-10-19 (`/api/stats/funnel?days=90`): 1,158 new browsers
since 2026-09-27 (771 phone, 387 desktop), 114 of them seen again on a later
day.

## The table

`visitors`: one row per browser. `id` is a random 32-hex id the browser
minted (localStorage `hd-visitor`); it is unrelated to the address, the
presence session and the phone lines' caller. `first_seen`, `last_seen`,
`first_day`, `last_day`, `visit_days` (distinct UTC days), `device`, `look`,
`country` (ISO alpha-2), `region` (the subdivision's English name), and:

- `origin`: `browser` (posted itself) or `funnel` (a backfilled placeholder);
- `here_before`: arrived with a library, i.e. a visitor from before the
  funnel. Its `first_seen` is when the table first saw it;
- `funnel_cohort` / `funnel_device` / `funnel_look`: the browser's own funnel
  arrival, what a claim matches.

**No address is stored anywhere.** The address is looked up in memory and
dropped; the table's CHECK holds `country` to two letters.

## Backfill, and why nobody is counted twice

The funnel's arrivals have no id, so each becomes a placeholder row
(`origin = 'funnel'`, `first_day` = cohort, device, look, no location). A
browser posts its own funnel arrival with its visit; the first time it names
one, **one placeholder for that (day, device) is deleted in the same
transaction** (same look first) and the browser's row takes the arrival's
day as its first. The total does not move.

`reconcileVisitorBackfill()` runs on every 2-minute traffic sample: it makes
the placeholders equal to arrivals minus claimed browsers per (day, device,
look) (`planPlaceholders`, pure and tested), and sets `visit_days = 2` on as
many placeholders as the funnel's `return` step implies (scaled to the
placeholders left; the one estimate, and it moves only `visit_days`). It is
idempotent, so arrivals counted by a tab still on an old build are picked up
within two minutes. Both writers take one advisory lock.

So the all-time count is: every browser seen since this shipped, plus every
funnel arrival since 2026-09-27 that has not come back yet, plus browsers from
before 2026-09-27 that come back (`hereBefore`, counted from the day they
return). What it cannot include is a browser from before 2026-09-27 that never
returns: say so on the page ("counting since 27 September 2026").

Known limits, the same as every browser-side count: clearing site data, a
private window or a second browser is a new visitor; a bot that runs
JavaScript and lies about its user agent counts. Robots that announce
themselves are dropped (`isBotUserAgent`), and one client can add at most 30
new ids an hour.

## Location

`src/lib/geo/geoip.ts` reads an MMDB file on this server
(`/var/lib/highdesert-geoip/city.mmdb`, `GEOIP_DB` to override). Default:
**DB-IP IP to City Lite** (free, no account, CC BY 4.0: the page must credit
"IP Geolocation by DB-IP" with a link to db-ip.com; every API response
carries `attribution`). With `GEOIP_MAXMIND_LICENSE_KEY` in
`/root/.high-desert.env` the refresh fetches GeoLite2 City instead.

- Country and region at request time, on `/api/stats/visitor` (the visitor's
  latest place) and on every heartbeat (`active_sessions.country/region`, for
  "right now").
- **City only when reliable**: GeoLite2 reports an accuracy radius and a city
  is kept only within 50 km. DB-IP Lite reports none, so with it the feed is
  region-level, always. Tested on 2026-10-19: DB-IP put 8.8.8.8 in California
  and a Comcast address in Rohnert Park, a city we would not want to print.
- The file is 127 MB and loaded whole into the app's memory (`MemoryMax` is
  1200M); a refresh is noticed by mtime within 10 minutes, no restart.
- Refresh: `highdesert-geoip.timer`, the 4th of each month 04:40 UTC,
  `scripts/update-geoip.mjs` (checks the file opens, is a City database built
  within 75 days, and resolves 8.8.8.8 to the US, then renames it in place;
  a failure keeps the old file). `status.json` beside it says how it went.

## The routes

- `POST /api/stats/visitor` `{visitorId, device, look?, cohort?, cohortDevice?, cohortLook?, hereBefore?}` → `{ok, counted}`. Answered in the page by the e2e fixture (`SERVER_WRITES`).
- `GET /api/stats/visitors` → `{countingSince, totals: {visitors, browsers, backfilled, hereBefore, newThisWeek, activeThisWeek, returning}, locations: {allTime, week, now}, attribution}`; each location block is `{total, countries: [{country, name, n}], states: [{region, code, n}]}`, unknown last.
- `GET /api/stats/tuning-in` → `{entries: [{at, country, name, region, code, city}], attribution}`: the last 10 tune-ins to the live station (one per client per half hour, kept 7 days).
- `GET /api/stats/records` → `{biggestCrowd: {online, listening, at, day, since}, biggestDay: {day, plays}, biggestArrivalDay: {day, visitors}, mostPlayed: {episodeId, plays, title}}`. The crowd counts from 2026-09-24, when `online` began counting people.

## Setup on the VPS

1. Deploy as usual (`bash scripts/deploy.sh`): the lockfile changed (`mmdb-lib`),
   the schema changed (applied by deploy), and the backfill runs on the next
   sample.
2. `bash scripts/geoip-setup.sh`: installs the timer and fetches the first file.
   Until it has run, every place is unknown and nothing fails.
3. `node scripts/audit-access-logs.mjs --geo` for the log window, if wanted.
