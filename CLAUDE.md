# High Desert — Project Guide

> A desktop-grade web player for the Art Bell radio archive. Windows 98 dark UI on desktop, glassmorphism on mobile, streaming from archive.org, all data stored client-side in IndexedDB.

**Live:** [highdesert.space](https://highdesert.space) | **Repo:** `jacksongoode/High-Desert`

## Quick Start

```bash
npm install
cp .env.example .env.local   # DATABASE_URL (optional — stats degrade gracefully without it)
npm run dev                   # http://localhost:3000
npm run build                 # production build
npm run lint                  # ESLint (next/core-web-vitals + typescript)
npm run test                  # Vitest
npm run test:mutations        # does each test actually observe its subject?
npm run check:csp -- <url>    # every route in Chromium: CSP violations / console errors
E2E_BASE_URL=<url> npm run test:e2e   # Playwright, desktop + mobile projects
# e2e/live.spec.ts: a LOCAL build on the e2e database (schema applied), never production — see its header
```

**e2e specs import `test` from `e2e/fixtures.ts`, never from `@playwright/test`** (ESLint
enforces it). The fixture answers every stats write in the page and blocks the service
worker, whose fetches bypass `page.route()`. Without it, a spec that starts a show writes a
permanent play to whatever server it points at — this broke the test DB once. Run e2e servers
against the e2e database (`/root/.high-desert-e2e.env`), never `TEST_DATABASE_URL`.

**On the VPS, heavy scripts take turns.** `build`, `lint`, `typecheck`, `test`,
`test:mutations` and `test:e2e` (and each mutation's vitest, and `deploy.sh`'s `npm ci`
and build) run through `scripts/heavy.sh`, i.e. the box-wide `heavy` semaphore (one slot
since 2026-10-13, niced, waiting while the 6-hour CPU mean is over 40%: `heavy status`);
where `heavy` is absent (CI) they run directly. Playwright runs one worker off CI. Memory fell to 13% on 2026-09-28 with five
at once (`docs/memory-2026-09-28.md`). Watch modes are deliberately not wrapped.

(Quick Start is for a *development* checkout. In `/root/High-Desert`, which is
production, never `npm install` — see "Deploying to the VPS".)

**Checks run on the VPS, never on GitHub Actions** (standing rule, Jackson,
2026-10-15). Do not run, trigger or wait on GitHub Actions. Before a push or a
deploy, run the checks here, each through `heavy` (the npm scripts already go
through `scripts/heavy.sh`):
- `npm run lint`, `npm run typecheck`, `npm run test` (with
  `set -a; . /root/.high-desert-test.env; set +a` for the database tests);
- the mutations a change touches, `node scripts/mutate-check.mjs <id-substring>`
  (clean tree; a worktree for anything outside `.github/`, `docs/` and
  `scripts/`), or all of them with `npm run test:mutations`;
- for anything a browser loads: `npm run build` in a worktree, then
  `npm run check:csp` and `npm run check:seo` against it, and the e2e specs it
  touches (one Playwright run at a time). After a deploy, `check:seo` and
  `check:csp` against production.

`ci.yml` and `mutations.yml` are **manual only** (`workflow_dispatch`): no
push, pull request or schedule runs them (`scripts/__tests__/ci-workflows.test.ts`,
mutations `ci-manual-only` and `ci-mutations-manual-only`). Run them on GitHub
only when Jackson asks. There is no pre-push
hook: **no git hooks in production trees** (2026-09-28: a local pre-push gate ran the suite
with git's hook variables set, and the tests' throwaway repositories wrote into the real
one, setting `core.bare = true` under `/root/High-Desert`). Every test that runs git
clears the `GIT_*` variables first (`src/test-support/git-env.ts`).

**Vitest cleans up after itself.** Each run left a module cache in
`$TMPDIR/<nanoid>/` (2,548 of them, 2.9 GB, on 2026-10-12);
`src/test-support/vitest-tmp.global.ts` removes the run's own on teardown
(`scripts/__tests__/vitest-tmp.test.ts` runs the real Vitest, with a control).
A test that makes a temp dir removes it.

**Database-backed tests** (`*.db.test.ts`, `scripts/__tests__/backup-db.test.ts`) need
`TEST_DATABASE_URL`, a `*_test` database — enforced by `src/test-support/test-db.ts`. CI
provides one; on the VPS: `set -a; . /root/.high-desert-test.env; set +a`. Without it they
skip, and `test:mutations` reports their mutations as **NOT CHECKED** rather than passing
(in CI a missing URL is an error).

**`npm run test:mutations` is not optional garnish.** Four defects in this project
were checks disconnected from the thing they checked — a watchdog whose listeners
were never attached, two tests that re-implemented their subject, and a handoff
that asserted "pushed to origin" without looking. A passing suite cannot tell those
from working ones. `scripts/mutate-check.mjs` breaks one real line per module and
requires the suite to notice. Read `docs/disconnected-checks.md`
before adding a test, and add a mutation alongside it.

**Where the mutations run** (since 2026-10-15): on the VPS, through `heavy`.
`node scripts/mutate-check.mjs <id-substring>`, or all of them with no argument
(`npm run test:mutations`). `--changed-from <ref>` checks what a change touched
and `--shard i/n` splits the list. Until 2026-10-15 GitHub ran them on every
PR, on main and nightly at 09:30 UTC; that workflow is now manual only.
- **The whole list runs weekly on the VPS, Mondays 14:00 UTC**
  (`highdesert-mutations.timer` → `scripts/weekly-mutations.sh`, Jackson,
  2026-10-15). It works in its own clone of main,
  `/var/lib/highdesert-mutations/checkout` (never the production tree:
  mutate-check edits the files it breaks), with its own `node_modules`
  (`npm ci` only when a lockfile changes), against the test database.
  - **Each mutation's vitest takes the `heavy` slot**, so the CPU gate is
    checked before every one and other sessions' jobs take turns with it.
    1,080 entries, about 1h20m at most of one core (measured 2026-10-15).
  - **It is the one High Desert job exempt from the 10% CPU rule** (no
    `CPUQuota`; Nice=19, idle IO; heavy runs it under nice 15). The status
    `cpu` line names `highdesert-mutations` as the exemption instead of
    failing on it.
  - **It leaves** `result.json` (`mutate-check.mjs --json` verdicts plus
    `head`, `error`, `log`), `running.json` while it goes, `runs/` (the last
    8) and `last.log`.
  - **`highdesert-status`'s `mutations` line reads it.** FAIL if a mutation
    survived or went stale. WARN if the run broke before checking, left
    database mutations NOT CHECKED, is over 8 days old or never finished.
    It also says when a run is going.
  - **The Monday digest** has a Mutations line under Health, and a survivor
    reaches Needs you through the status FAIL.
  - Run it by hand with `systemctl start --no-block highdesert-mutations`.
    Tests: `weekly-mutations.test.ts`, the status and digest tests,
    `service-unit.test.ts`. Mutations: `weekly-mutations-*`,
    `status-mutations-*`, `digest-mutation-*`, `status-cpu-exempt-one-unit`.

## Tech Stack

- **Next.js 16.2.2** (App Router) + **React 19** + **TypeScript 5**
- **Tailwind CSS v4** with custom Win98/glass design tokens (`src/styles/`)
- **Dexie 4** — IndexedDB ORM, reactive queries via `useLiveQuery`
- **Zustand 5** — client state (player, radio dial, scanner, scraper, search, admin, context menu, sleep timer, toasts)
- **Web Audio API** — oscilloscope visualizer, radio static generator, startup sound
- **Postgres** — community stats only (play counts, ratings, leaderboard, active listeners)
- **No third-party services** — self-hosted on the VPS; no analytics scripts, no hosted KV, no runtime AI
- **OPFS** — Origin Private File System for offline audio caching

## Architecture Overview

### Routing (`src/app/`)

| Route | Purpose |
|---|---|
| `/` | Welcome/splash with animated starfield |
| `/library` | Main episode browser — virtual list, search, filters, detail panel |
| `/radio` | Radio dial — tune through episodes on a frequency strip |
| `/scanner` | Local file scanner + archive.org catalog scraper (admin) |
| `/search` | Archive.org search and import (admin) |
| `/stats` | Listening statistics |
| `/show/<slug>` | One show, server-rendered for search engines (no app shell, works without JavaScript). See "Show pages and search" |
| `/guest/<slug>` | Every show with one guest (guests with 2+ shows). Same frame as show pages |
| `/show/<slug>?t=<s>` | A shared moment: the show page playing from that second, its own card, rendered per request (rewritten to `/show/<slug>/moment/<t>`, which itself 308s back) |
| `/topic/<slug>`, `/topics` | Every show on a topic (categories, curated subjects, big tags; `data/topic-slugs.json`), and the index |
| `/tonight`, `/tonight/<yyyy-mm-dd>` | One station day: its frozen program and the date's broadcasts. `/tonight` is a 307 to today (Pacific) |
| `/live` | High Desert Live — the 24/7 station: now playing, time left, up next, the day's log, the live count, the phone lines (chat). See "Live station" |
| `/request-line` | The Request Line: today's nominations for the station's 10 PM slot with their votes, tonight's pick once locked, its own share card. Server-rendered per request. See "Live station" and `docs/request-line.md` |

All primary pages share `(desktop)/layout.tsx` — the master client component that initializes the audio player, handles global keyboard shortcuts, seeds the library on first visit, and persists playback state.

### API Routes (`src/app/api/`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/archive/search` | GET | Proxy to archive.org advanced search (rate-limited 30/min) |
| `/api/archive/scrape` | GET | Proxy for catalog scrape (rate-limited 30/min) |
| `/api/archive/metadata` | GET | Proxy for item metadata (cached 1hr) |
| `/api/archive/health` | GET | archive.org reachability probe. Returns **`{up, status, checkedAt}`**. One upstream HEAD is shared by every caller for 60 s (up) / 10 s (down), and concurrent callers share the one in flight — every tab polls it (`useOutageMonitor`) |
| `/api/stats/play` | POST | Record a play. Body `{episodeId, sessionId, source?, build?, surface?, look?}`. Returns `{ok}`. `episodeId` must be in the community-key allowlist. `source` is where the audio came from — `archive`/`mirror`/`cache`/`local` (`PLAY_SOURCES`); anything else is **400**, absent is stored NULL (*unknown*, never assumed to be archive.org). `build` is the sending page's build (see "Long-lived tabs"); anything that is not a build id is stored NULL, never refused. `surface` is where it was started (`play_events.surface`, `src/audio/play-surface.ts`): `library`/`radio`/`live`/`stats`/`show`/`palette`/`queue`/`restore`/`other`; anything else is stored NULL, never refused (`docs/usage-tracking.md`). `look` is the sending page's look, `win98`/`night` (`play_events.look`, `docs/looks.md`); anything else is stored NULL, never refused |
| `/api/stats/stop` | POST | End playback. Body `{sessionId, keepPresence?}`. `keepPresence: true` clears only the listening mark (the tab is still open); omitting it deletes the session, which is what the unload beacon does. Returns `{ok}` |
| `/api/stats/rate` | POST | Submit a rating 1–5 or null. Body `{episodeId, rating}`. Returns `{ok}`. One ballot per client (IPv4 address / IPv6 /64), stored as an HMAC; **503 when `RATING_VOTER_SECRET` is unset** |
| `/api/stats/episodes` | GET | Play counts for up to **100** ids. Returns **`{counts: {id: n}}`** |
| `/api/stats/ratings` | GET | Ratings for up to **50** ids. Returns a **bare map** `{id: {avg, count}}` |
| `/api/stats/community` | GET | Community plays and ratings for the **whole catalog**: **`{episodes: {id: {plays, avg, count}}}`**, only episodes with a play or rating. What "Most played" / "Top rated" sort by and what the list's metric column shows (`src/lib/library/sort-keys.ts`), read through `useCommunityCatalog`. Proxy-cached 60s |
| `/api/stats/leaderboard` | GET | Top episodes. **`?period=alltime\|week` is required.** Returns **`{entries: [{episodeId, plays}]}`**. `alltime` is `episode_plays` — the same numbers as `/api/stats/community` and the library's "Most played" |
| `/api/stats/active` | GET | **Legacy alias**, read by no surface in the current build. Returns **`{count, online, listening}`** from the same `getPresence()` as `/now` — `count` is a synonym for `listening` |
| `/api/stats/heartbeat` | POST | Mark a session present. Body `{sessionId, episodeId?, live?, route?, device?, visible?}`. `live: true` (only a literal true) sets `active_sessions.live_at` — sent while tuned in to the live station and playing, or in its station ID; any beat without it clears the mark at once. Returns `{ok}`. Every open tab posts on a 60s interval. `episodeId` is sent **only while that tab is actually playing** and renews `listening_at` — it is what keeps a show on air for its whole runtime instead of for five minutes after someone pressed play. Omitting it leaves the listening mark alone rather than clearing it, so a pause does not yank the show off the air; the mark decays on its own. Same allowlist gate as `/api/stats/play`, but a bad id drops the mark instead of failing the beat — presence is the primary job. A client past `SESSIONS_PER_CLIENT` new sessions gets the same `{ok}` and is not counted. `route`/`device`/`visible` are time per tab, sent on the minute beat only (never the extra beats): `visible: true` with a known tab and device adds a minute to `route_daily` (at most `SESSIONS_PER_CLIENT` a minute per client); bad values are ignored and a failed minute never fails the beat (`docs/usage-tracking.md`) |
| `/api/stats/now` | GET | **The one presence endpoint.** Presence **plus what is playing**. Returns **`{online, listening, live, onAir: [{episodeId, listeners, title}], recent: [{episodeId, at, title}]}`**; `title` is the catalog's (null for an id it lacks), for a browser whose library has no row for the show. `online` is distinct *clients* (not sessions) with a heartbeat inside 5 min; `listening` is the subset with a playing session; `live` the subset tuned in to the live station (`live_at` inside the window); `listeners` is distinct clients per episode. `no-store` — a stale on-air list is worse than none. Aggregate only: no query joins `session_id` to `episode_id`, and `recent_plays` stores no session at all |
| `/api/stats/traffic` | GET | Traffic history. `?range=24h\|7d\|30d`. Returns **`{range, points: [{t, online, listening, onlineMax, listeningMax, plays}], peakOnline, peakListening, playsInRange, totalPlays, peakAt, hourly: [{hour, online, listening, plays, samples}]}`**. A point's `online`/`listening` are the bucket's **mean**, `onlineMax`/`listeningMax` its highest sample — the chart's main lines. **`peakOnline`, `peakListening` and `peakAt` come from the raw 2-minute samples**, never from the buckets: a max of averages shrinks as the bucket widens, and 30 days once read a lower peak than 24 hours (`docs/stats-audit.md`, finding 12). `traffic_daily` keeps `peak_online`/`peak_listening`/`peak_at` past the 90-day sample prune; `highdesert-status`'s `peaks` line FAILs unless peak(30d) ≥ peak(7d) ≥ peak(24h). `hourly` is always a 24-entry, zero-filled, **UTC**-hour profile over the last 30 days and does *not* vary with `range`; the client rotates it into local time. `samples: 0` means *never observed*, which is not the same as "observed, nobody here" — the UI hides the profile until 8 hours have been sampled, or a day-old deployment draws 23 empty columns and looks like a dead site. **`playsBySource: {archive, mirror, …, unknown}`** counts `play_events` in the range by `source` — what `highdesert-status` reads for "mirror plays in 24h" |
| `/api/stats/sample` | POST | Writes one traffic sample, then rolls up the day and expires old session refs. Requires `x-sample-token`; called only by `highdesert-sample.timer`. Also prunes `weekly_plays` past 3 weeks. Returns `{ok, online, listening, live, totalPlays, rolledUp, anonymized, prunedWeeks}` (`live` is reported, not sampled — `listener_samples` has no column for it) |
| `/api/playback-event` | POST | A show failed to start. Body `{episodeId, kind, retried, recovered, elapsedMs, uaClass, detail?}`. `kind` is one of `timeout`/`stall`/`play-rejected`/`handover-rejected`/`network-error`/`decode-error`/`empty-media`/`empty-media-suspected` (`handover-rejected`: the live station's change of show refused, counted like any failed start); `uaClass` is a coarse bucket from `src/lib/utils/platform.ts`, **never a raw user-agent**. `detail` is short (≤200 char) free text: the reported duration on an advisory row, or `MediaError.code` plus its message on a `decode-error`/`network-error`/`empty-media`. That message is a browser pipeline diagnostic (`DEMUXER_ERROR_COULD_NOT_OPEN: …`) and is the **only** way an empty file is distinguishable from an unreachable one on Chromium, which errors on the missing frames rather than reporting a short duration. A `detail` containing `HD-VERIFY` (any case, checked after truncation) is **rejected with 400** — this table is the instrument that decides whether the 5s duration floor is safe to promote, and verification rows have polluted it twice; intercept the POST in the page instead. No session id, no IP. `episodeId` must be in the community-key allowlist. Optional `source` as on `/api/stats/play`, but an unknown value is stored NULL rather than refused — losing a failure row costs more than losing its source. A failover row carries the source that *failed* (`archive`) and `recovered: true` once the mirror plays. Optional `build`, as on `/api/stats/play` |
| `/api/live/schedule` | GET | **The live station's program.** Returns **`{day, tz: "America/Los_Angeles", serverNow, stationIdSec: 8, now, upNext: [Slot, Slot], rest: [Slot], guide: [Slot], outage}`**. `now` is `{slot, startedAt, offsetSec, endsAt}` (a show: start and offset into it) or `{stationId: true, endsAt}` (the gap between shows). `Slot` is `{fileHash, episodeId, title, airDate, guestName, showType, duration, sourceUrl, kind: "on-this-date"\|"fan-favorite"\|"outage-swap", start, end, replaces?}`, times epoch ms. `upNext` reaches into tomorrow during the day's last show; `rest` is the rest of *today* after it; `guide` is all of today, past included. `outage: true` when archive.org is down and the swap was applied. `no-store`, 30/min, **503** without a database |
| `/api/shows/link` | GET | `?key=<communityKey>` → **`{slug, path}`**, a catalog show's page (cached a day). **404** `{error: "not-a-show"}` (cached an hour), **400** for a malformed key. What the Share buttons ask (`src/hooks/useShowSlug.ts`); the slug map stays on the server |
| `/api/build` | GET | **`{build}`**: the build this server runs (`NEXT_PUBLIC_BUILD_ID`, the short SHA). `no-store`, 30/min. What an open tab compares its own `<meta name="hd-build">` with (`src/services/build/stale-tab.ts`) |
| `/api/live/time` | GET | The server clock for the client's time sync: **`{now}`** (epoch ms). `no-store`, 60/min. The client takes 5 samples and keeps the one with the smallest round trip |
| `/mirror/{fileHash}` | GET | **Not Next.js — nginx alone** (`services/mirror/lib/nginx.mjs`). The episode's MP3: a pinned one off disk, anything else in the catalog filled from archive.org through nginx's slice cache. Byte ranges: `206` + `Content-Range`, `416` for an unsatisfiable range. **404** for anything not in the catalog; **502** when a fill cannot reach archive.org. GET/HEAD only. See "archive.org outage mirror" |
| `/mirror/manifest` | GET | **Not Next.js** — a static file (`/var/lib/highdesert-mirror/manifest.json`, written atomically by the warm job). What the mirror can play with archive.org gone: **`{version, count, pinned, repaired, fileHashes: [...]}`** — every pinned episode whole on disk, plus every repaired copy (`count` = `pinned` + `repaired`). `version` is a digest of the list; the **`ETag` is nginx's**, and `If-None-Match` with it gets a 304. `Cache-Control: max-age=60`. Outage mode's input (`src/services/mirror/manifest.ts`) |
| `/mirror/magnet/{fileHash}` | GET | Static: **`{infohash, magnet}`** for the episode's own single-file torrent (trackers, the archive.org webseed as `ws=`; no `x.pe` — nothing here seeds). 404 outside the catalog. The episode sheet's "Magnet link" |
| `/live-api/stream` | GET | **Not Next.js** — `highdesert-live` on 127.0.0.1:3005, the phone lines (`docs/live-chat.md`). SSE: `hello {you: {name, line, place, firstCall, admin}, slowMode, recent, resumed, hidden, tuneins}`, then `message {id, at, name, place, line, body}` (SSE `id:` = message id; `place` is "calling from" as sent, or null), `hide {ids}`, `slow`, `rename {ids, name, place?}` (`place: null` when an admin's clear-name cleared it), `tunein {at, count, places}` (batched: at most one a minute, one per caller an hour; `tuneins` in hello is the last 3). `archive {id, at, text, form, speaker, episode, reason}`: a moment from the show's history, posted into a quiet room (below); `archive` in hello is the last 3. `Last-Event-ID` resumes. nginx: buffering off, `limit_conn` 200 per address (one address can be a carrier NAT; nginx is never tighter than the service, `nginx-vhost.test.ts`) |
| `/live-api/messages` | POST | **Not Next.js.** `{body}` → **201** `{id, at, name, place, line, body}` (body as stored — mild profanity masked). **400** `{error: "rejected", reason, message}`, **429** `{error: "rate", retryAfter, slowMode}`, **403** muted/banned. Every `/live-api` POST needs `Content-Type: application/json` (415) and a highdesert.space `Origin` (403) |
| `/live-api/name`, `/live-api/report`, `/live-api/me` | POST/POST/GET | **Not Next.js.** Rename `{name}` → `{name, line, nextChangeInS}` / 409 taken / 429; report `{messageId}` → `{ok, hidden}`; me → `{name, line, place, firstCall, admin, mutedUntil, nextNameChangeInS, nextPlaceChangeInS, slowMode}` |
| `/live-api/place`, `/live-api/tuned` | POST/POST | **Not Next.js.** "Calling from": `{place}` → `{place, nextChangeInS}`; filtered like a name (400 `place-*` reasons), a change at most every 10 min (429), `""`/null clears it at once and never waits. Suggested in the browser from its time zone only, never from an address. Tuned: `{}` → `{announced}`; the caller tuned in to the station (sent by `tuneIn()`), announced to the room as a `tunein` line with their place |
| `/live-api/requests`, `/live-api/requests/vote`, `/live-api/admin/request-veto` | GET/POST/POST/POST | **Not Next.js.** The Request Line (`docs/request-line.md`). GET → `{day, closesAt, startsAt, nominations: [{id, fileHash, title, airDate, guestName, name, place, note, votes, mine, voted}], nominated, tonight, admin}`. POST `{fileHash, note?}` → 201 a nomination (one per caller per Pacific day), 200 `joined: true` when the show was already up (a vote); 409 `already-nominated`/`played-recently`/`broken-file`, 400 a note the filter refuses. Vote `{nominationId}` → `{ok, counted, votes}`, 409 `closed` from 6 PM Pacific, 410 vetoed, 429 past 10 votes per address per show. Veto: admin only |
| `/live-api/admin/*` | POST | **Not Next.js.** `hide`, `mute`, `ban`, `slow`, `clear-name`, `verify` (the deploy's round trip), `signin` `{nonce}`, `signout`; GET `signin-page`. Cookie or `Authorization: Bearer $LIVE_ADMIN_TOKEN`, else **401** `{error: "admin-only"}`. `/live-api/health` is loopback only (nginx 404s it) |
| `/api/stats/failures` | GET | Which episodes are failing, worst first. `?days=7\|30\|90`. Returns **`{days, summary, entries: [{episodeId, title, failures, recovered, skippedRetries, plays, rate, kinds, uaClasses, details, lastAt}]}`**. Ids resolved to titles from the seed catalog. `details` is the browser's own diagnostics (up to 3 distinct, newest first), **filtered to diagnostic shapes** — the raw text is attacker-controlled (`publicDetails`, HD-038). `skippedRetries` counts retries not attempted for want of a user gesture, excluding `empty-media`, which is never retried by design — it is the instrument for the activation gate. `summary` is site-wide and is deliberately **not** a sum of `entries`, which is capped at 50 episodes. **Excludes advisory kinds** (`ADVISORY_KINDS` in `src/services/stats/db/failures.ts`) — this ranks episodes by how badly they are failing, and a row that never stopped playback would inflate that. Unauthenticated — it is aggregate-only, and the admin gate is presentation, not protection. `?since=<ISO>` adds **`window: {from, to, failures, recovered, plays, byBuild: [{build, failures, recovered, plays}]}`**, the fixed 7 days from that instant (cut at now) — how `highdesert-status` holds a release to `docs/reliability-baseline.md`, leading with `failures − recovered` (starts the listener lost) |
| `/api/stats/funnel` | POST/GET | **The arrival funnel** (`docs/funnel.md`). POST `{step, cohort, device, look?, again?}`: a browser reached `visit`/`live`/`tune`/`call`/`return` for the first time (`return`: back on a later UTC day), and first arrived on `cohort` (UTC `YYYY-MM-DD`, within 30 days) as a `phone` (narrower than 768 px) or `desktop`, fixed at arrival; `look` is the look it took the step in (`win98`/`night`, else stored NULL), `again: true` when it already counted the step in its other look (each look's funnel is whole; totals count `again` rows never); adds one to `funnel_daily`. Returns `{ok}`; 10/min. GET `?days=7\|30\|90` → **`{days, cohorts: [{day, device, visit, live, tune, call, return}], totals, byDevice: {phone, desktop}, byLook: {win98: {phone, desktop}, night: {phone, desktop}}}`**, `no-store`. A browser that arrived with an empty library is counted; one that already had a library is excluded for good (`src/services/stats/funnel-client.ts`, which keeps "once" in localStorage `hd-funnel`). No session, no address, no id. `highdesert-status`'s `funnel` line reads it. Anything that browses production headless must keep out of it: `csp-check` marks its browser excluded, `presence-check` and the e2e fixture answer the POST in the page |
| `/api/stats/view` | POST | **A tab entered** (`docs/usage-tracking.md`). Body `{route, device, arrival?: {source, landing, look?}}`: adds one view to `route_daily` for today (UTC). `route`/`landing` are `welcome`/`library`/`radio`/`stats`/`live`/`show`/`other` (`routeOf()`, `src/lib/usage/vocab.ts`), `device` `phone` (narrower than 768 px) or `desktop`; an unknown route or device is **400**. `arrival` rides on a browser session's first view (sessionStorage `hd-arrival`): a coarse class decided in the browser, `reddit`/`google`/`other-search`/`ai`/`social`/`internal`/`direct`/`other` (`src/lib/usage/arrival.ts`), counted in `arrival_daily` with the look it landed in (`win98`/`night`, else NULL); a malformed one is dropped and the view still counted. Returns `{ok}`; 60/min. Sent by `UsageTracker` (root layout) once a tab has been on screen 1 s. **Never** a referrer, host, URL, session, address or user agent. Kept out like the funnel: `localStorage["hd-not-counted"]` (set by `csp-check`) stops it, and the minutes and funnel steps too; `presence-check` and the e2e fixture answer the POST in the page |
| `/api/stats/usage` | GET | **Usage, aggregate only.** `?days=7\|30\|90` (else 7) → **`{days, routes: [{route, device, views, minutes}], arrivals: [{source, landing, device, look, n}], playsBySurface: {library, radio, live, stats, show, palette, queue, restore, other, unknown}, playsByLook: {win98, night, unknown}}`**. UTC days, today included; `routes` most viewed first, `arrivals` largest first; `playsBySurface` counts `play_events` in the same window (`unknown`: no surface). `no-store`, 30/min |
| `/api/stats/visitor` | POST | **A browser was here** (`docs/visitors.md`). Body `{visitorId, device, look?, cohort?, cohortDevice?, cohortLook?, hereBefore?}`: the browser's random id (localStorage `hd-visitor`, 16–64 of `A-Za-z0-9_-`, never `funnel-…`), once per page load from `UsageTracker`, with its funnel arrival once known, which claims one backfilled placeholder. Returns `{ok, counted}` (`counted: false`: a robot's UA, or past 30 new ids per client an hour). The address is looked up in the self-hosted geo database (country, region) and **never stored**. 20/min |
| `/api/stats/visitors` | GET | **Unique visitors, all time, and where.** **`{countingSince, totals: {visitors, browsers, backfilled, hereBefore, newThisWeek, activeThisWeek, returning}, locations: {allTime, week, now}, attribution}`**, each location `{total, countries: [{country, name, n}], states: [{region, code, n}]}` (US only), unknown (null) last. `now` is the presence set by where heartbeats resolved. `countingSince` is the first funnel cohort (2026-09-27). `no-store`, 30/min |
| `/api/stats/tuning-in` | GET | **`{entries: [{at, country, name, region, code, city}], attribution}`**, the last 10 tune-ins to the station, newest first, one per client per half hour. `city` only when the geo database reports an accuracy radius ≤ 50 km (never with DB-IP Lite). `no-store`, 60/min |
| `/api/stats/records` | GET | **`{biggestCrowd: {online, listening, at, day, since}, biggestDay: {day, plays}, biggestArrivalDay: {day, visitors}, mostPlayed: {episodeId, plays, title}}`**, each null when empty. The crowd counts from 2026-09-24 (`since`), when `online` began counting people. `max-age=60`, 30/min |
| `/api/stats/export` | GET | **The permanent record, for sang3r.com.** Requires `x-service-token` (`STATS_EXPORT_SECRET`). `?mode=summary\|events\|daily\|episodes`. The only route that returns the event log rather than aggregates, and the only one not reachable from a browser. Episode ids are resolved to titles from the seed catalog. Page `events` with `after=<last id>` — **not** with `since`, which cannot disambiguate two plays sharing a timestamp |

> Response shapes are inconsistent by history, not design. `src/services/stats/client.ts`
> tolerates both wrapped and bare forms — a mismatch here silently made every community
> play count read as 0 for months. Document the shape when adding a route.

### Data Flow

1. **No server-side persistence** — all episode data lives in IndexedDB (Dexie)
2. **Audio streaming** — archive episodes stream via `archive.org/download/...` URLs
3. **Local files** — scanned, hashed (MD5), metadata extracted (ID3/Vorbis), cached in OPFS
4. **AI categorization is offline only** — `scripts/categorize-library.py` runs against the catalog and its output ships in `public/seed/library.json`. There is no runtime AI endpoint and no API key in the app
5. **First visit** — library auto-seeded from `/public/seed/library.json`

## Key Directories

```
src/
├── app/                  # Next.js App Router pages + API routes
│   ├── (desktop)/        # Main route group (shared layout with player)
│   └── api/              # archive.org proxies + community stats
├── audio/                # Audio engine modules (singleton pattern)
│   ├── engine.ts         # HTMLAudioElement + AudioContext singleton
│   ├── cache.ts          # OPFS audio blob cache
│   ├── radio-static.ts   # White noise generator for radio page
│   ├── visualizations/   # Oscilloscope/bars/radar/VU/waterfall/milkdrop renderers + registry
│   └── startup-sound.ts  # Synthesized boot chime
├── components/
│   ├── desktop/          # Shell, starfield, dialogs (about, shortcuts, clear)
│   ├── library/          # EpisodeCard, EpisodeDetail, TimelineView, SearchBar, widgets
│   ├── player/           # AudioPlayer, Oscilloscope, PlaybackControls, QueuePanel
│   ├── radio/            # RadioDial, TuningStrip, DialControls, SignalMeter
│   ├── scanner/          # FolderPicker, ScanProgress, ScanResults
│   ├── scraper/          # CatalogScraper, CollectionImport
│   ├── search/           # SearchPanel, ArchiveResultCard
│   ├── mobile/           # MobileMenuSheet
│   ├── ui/               # Toaster
│   ├── win98/            # Win98 component library (Button, Window, Dialog, MenuBar, etc.)
│   ├── CommandPalette.tsx
│   └── PageTransition.tsx
├── db/
│   ├── schema.ts         # Episode, Playlist, HistoryEntry, Bookmark, ScanSession, UserPrefs
│   ├── index.ts          # Dexie instance, indexes, migrations (v8), pref helpers
│   ├── deduplicate.ts    # Duplicate detection and merging
│   └── seed.ts           # Seeding, reconcile (restores missing episodes), export
├── hooks/                # Custom React hooks
├── lib/utils/            # cn, format, rate-limit, retry, search-parser, streak,
│                         #   community-key, scroll-lock, platform
├── services/
│   ├── archive/          # Archive.org client, scraper, filename parser
│   ├── scanner/          # File scanner, hasher, metadata extractor, filename parser
│   ├── episodes/         # Episode CRUD, favorites, ratings, bookmarks, playlists
│   └── stats/            # Community stats client + Postgres queries (db/: pool, presence,
│                         #   plays, ratings, traffic, failures, export; store.ts re-exports)
├── stores/               # Zustand stores
└── styles/               # win98.css, animations.css, crt.css, radio.css
```

## Stores (Zustand)

| Store | Key State |
|---|---|
| `usePlayerStore` | `currentEpisode`, `queue[]`, `queueIndex`, `playing`, `position`, `duration`, `volume`, `playbackRate`, `shuffle`, `repeat`, `mini` |
| `useRadioDialStore` | `position`, `lockedEpisode`, `signalStrength`, `scanning`, `zoom` |
| `useScannerStore` | `status`, `totalFiles`, `processedFiles`, `newEpisodes`, `duplicates` |
| `useScraperStore` | `phase`, `fetched`, `total`, `imported`, `categorized`, `errors` |
| `useSearchStore` | `query`, `results[]`, `loading`, `addingIds`, `addedIds` |
| `useSleepTimerStore` | `remaining`, `active`, `fadeFrom` |
| `useToastStore` | `toasts[]` — also exports module-level `toast.success/error/info/caller()` |
| `useAdminStore` | `isAdmin` — SHA-256 password gate, persisted in localStorage |
| `useContextMenuStore` | `open`, `position`, `items[]` |
| `useOutageStore` | `archiveUp` (verdict, null = unknown), `manifest`, `unavailable` — see "Outage mode" |
| `useLiveStore` | `tuned`, `phase` (`off`/`show`/`station-id`), `current` slot, `clockOffsetMs`/`clockRttMs`, `schedule`, `drift` — see "Live station" |
| `useProgressStore` | `byHash` (fileHash → `Progress`), `started`, `loaded` — the in-memory mirror of the `progress` table; see "Playback position lives in `progress`" |

All twelve have tests in `src/stores/__tests__/` and at least one mutation each in
`scripts/mutate-check.mjs` — and `src/stores/__tests__/coverage.test.ts`
*checks* that sentence, reading the stores from disk and the mutation list from
the script itself. It used to be false for `player-store` (HD-042) and nothing
noticed. A new store fails CI until it has both.

**`setVolume()` writes `preMuteVolume` on every call with a non-zero value.** Anything that
changes the volume temporarily must remember the original itself and put it back — reading
`player.volume` or `preMuteVolume` on a later tick reads back its own output. The sleep
timer's fade did exactly that: it compounded to ~0.7% with fifteen seconds still to run,
then "restored" that faded number as the listener's setting, and because `preMuteVolume`
had been overwritten too, muting and unmuting could not recover it either. The app was
simply quiet the next morning with nothing on screen to explain it. `useSleepTimerStore`
now captures `fadeFrom` once and hands exactly that back — on expiry, and on cancel. A
timer that expires without ever fading does not touch the volume at all.

## A show's name, and its guest (2026-10-01)

- **A file name or a key is never shown as a title.** Every surface names a row
  with `episodeTitle()` and an id from the stats API with `keyTitle()`
  (`src/lib/library/display-title.ts`). On Air printed
  `Art-Bell_Midnight_In_the_Desert--2015-12-08_--_Ar…` for a show the
  listener's library lacked. `display-title.test.ts` fails on any `title ||
  fileName` spelled elsewhere in `src/` (`dedupKey` is identity and exempt).
- **Bump `SEED_VERSION` whenever the catalog's set of shows changes.**
  Reconcile runs once per version; the 2026-09-28 import of 101 shows did not
  bump it, so nobody seeded before then received them.
  `src/db/__tests__/seed-version.test.ts` records the set's digest against the
  version and fails when one moves without the other.
- **A guest field that only repeats the title is not a guest.** 136 were
  removed from the seed (`docs/catalog-guests.md`, `scripts/clean-guest-repeats.mjs`);
  libraries seeded earlier keep them, so surfaces show a guest through
  `shownGuest()` (`src/lib/library/guest.ts`). A person whose name is the
  title is a real guest and stays. Ten more that described the programme
  ("Area 51, Earthquakes, and Crop Circles") moved into `topic` on 2026-10-09
  (`MOVED_TO_TOPIC`, `scripts/move-guest-topics.mjs`); `shownGuest()` hides
  those by exact `fileHash` and value on older libraries.

## A phone's chrome around a failed show (2026-10-09, `e2e/phone-chrome.spec.ts`)

- **A dialog's body is opaque.** `Dialog` passes `opaque` to `Window`, which
  drops `glass-heavy` (72% and a backdrop blur) for the solid
  `bg-raised-surface`; the studio's text read through "Transmission
  Interrupted" on a phone.
- **One message per failure.** Once `loadState` is `"failed"`, the dialog is
  the message: `media-events.ts` ignores a later `error` (WebKit fires one
  after the watchdog gives up) and `AudioPlayer` draws no red banner.
- **One bar at the bottom of a phone.** The desktop status bar sits in
  `<footer className="hidden md:block">` in `DesktopShell`. `hidden` on the bar
  itself does nothing: `win98.css` is unlayered, so `.w98-statusbar-dark
  {display:flex}` beats every layered Tailwind utility. Hide a w98 element
  from its wrapper.

## Library sorts — whose numbers, and one of them

`src/lib/library/sort-keys.ts` decides, once, what each numeric sort orders by:
**"Most played · everyone"** and **"Top rated · everyone"** are community numbers
(`/api/stats/community`); **"My plays"** and **"My rating"** are this browser's. The
comparator (`sortEpisodes`), the group buckets (`deriveRailGroups`) and the list's metric
column (`metricFor`) all read `sortValue` — "Most played" once sorted by local plays, grouped
by them, and showed community counts, so the rows read 41, 6, 78, 120 under a "Played 2–4
times (2)" header. **Every group has an inline header** (`list-layout.ts`); row offsets are
not `index × rowHeight`, so scroll through the list (`scrollListToRow`), never by arithmetic.
`sort-properties.test.ts` holds every sort monotonic and every header count equal to its rows.

## /stats — every number has a test that recomputes it

Local figures come from `computeLibraryStats()` (`src/lib/stats/library-stats.ts`),
recomputed from raw rows in `src/lib/stats/__tests__/library-stats.test.ts` against the
real catalog; the page test (`src/app/(desktop)/stats/__tests__/stats-page.test.tsx`)
holds the page to that function. Findings and fixes: `docs/stats-audit.md`.

- **Listened is time heard**, measured from the 250 ms position tick
  (`src/services/episodes/listen-time.ts`) and stored as `history.duration`. Never derive
  it from `playbackPosition` — that is *where you are*, reset to 0 on `ended`.
- **Personal lists say so.** "My Most Played" is this browser's `playCount`; Community
  Top 20 is everyone's. Each drills into the library sort that uses its own numbers
  (`my-plays`, `played`).
- **Supporters** (2026-10-09): the panel after Signal Traffic thanks listeners who
  chipped in, from `src/lib/support/supporters.ts`, **first name and last initial
  only** (a test fails on a full name, and on either full surname anywhere in
  `src/`), and links the Venmo. Add a gift at the top of the list.
- **"Plays all time" exceeds every range total by design** — the counter predates the
  `play_events` log (2026-07-28). The page says so.

## Event bus and library intents — read before adding a cross-component signal

**The bus is typed: `src/lib/events.ts`.** `HdEventMap` declares every key and its
detail type; `emit("play-episode", ep)`, `useHdEvent("key", handler)` (one
subscription, latest handler) and `onHdEvent` for non-React code. The transport is still
a `window` CustomEvent named `hd:<key>`, so e2e specs can listen and dispatch by name
(they take it from `hdEventName()` via `e2e/fixtures.ts`, never spelled) — but in
`src/` an `hd:*` string literal anywhere except events.ts is an ESLint error
(`HD_EVENT_NAME_RULES`, proven in `src/lib/__tests__/eslint-rules.test.ts`). Always pass
the key as a string literal.

**An instruction needs a listener on every route it can fire from.**
`src/lib/__tests__/event-routes.test.ts` walks the import graph from each `page.tsx` and
its layouts, and fails when a key is emitted on a route where nothing listens. That is
HD-013: "Shuffle Coast" in the palette on `/stats` fired an event only the library page
heard. Keys that merely announce something (`HD_NOTIFICATIONS`: `seed-settled`,
`text-scale`, `status-message`) are exempt.

| Key | Emitted by | Heard by |
|---|---|---|
| `play-episode` | library, stats, radio, search, palette, player, queue, stores | `(desktop)/layout.tsx` |
| `episode-unavailable` | `useAudioPlayer`, `(desktop)/layout.tsx` (a pulled episode) | `UnavailableEpisodeDialog` |
| `scan-preview`, `scan-preview-stop` | `useRadioDial` | `(desktop)/layout.tsx` |
| `filter-tag`, `filter-category`, `filter-series`, `show-guest` | `EpisodeCard`, `EpisodeDetail` (on /library) | `useLibraryBusListeners` |
| `easter-egg` | layout keys, library, `SearchBar` | `DesktopShell` |
| `admin-prompt` | `SearchBar` | `AdminPromptDialog` |
| `toggle-shortcuts` | layout `?` key | `DesktopShell` |
| `toggle-ultra-mini` | `StatusBar` | `AudioPlayer` |
| `seed-settled` | layout | library (notification) |
| `text-scale` | `applyTextScale` | `useTextScale` (notification) |
| `status-message` | `toast-store` | `StatusBar` (notification) |

**Library intents are URLs, not events** (`src/lib/library/intents.ts`):
`/library?shuffle=all|coast|dreamland|special`, `?sort=<SortMode>`, `?q=<search>`,
`?scroll=current`, `?show=<communityKey>` (select that show; a show page's "Open in High Desert"), with `&t=<seconds>` (a shared moment: play it from there), `?resume=<communityKey>` (start that show at its saved second through the library's play; the welcome page's Continue listening, which sits at the top of the Library too: `src/lib/library/continue-listening.ts`). Callers use `useOpenLibraryIntent()` — push from another route,
replace on /library — never an event and never `setTimeout` waiting for the page to mount.
`LibraryIntentReader` parses (invalid values ignored), clears the parameters with a
replace, and `useLibraryIntents` applies them once the data they need exists.
`/`, Ctrl/Cmd+F and Q are registered by the library itself
(`useLibrarySearchShortcuts`), so the browser's find works on every other route.

## Show pages and search (read before touching `src/lib/shows/`, `src/app/show/`, `src/app/guest/` or `data/show-slugs.json`)

Every catalog show has `/show/<slug>`, and every guest with 2+ shows `/guest/<slug>`,
so a search for a guest or topic can land on the show (2026-10-12). Full account and the
Search Console steps: `docs/show-pages.md`.

- **Slugs are permanent.** `data/show-slugs.json` (`fileHash` → slug, e.g.
  `1992-12-12-area-51-john-lear-bob-lazar`) is committed and **add-only**: never edit or
  regenerate an existing entry, even when a title is corrected; a pulled show keeps its
  entry and its slug is never reused. **After adding shows to the catalog, run
  `node scripts/gen-show-slugs.mjs`** and commit the map; `show-slugs.test.ts` fails on a
  show without a slug and on any committed slug that changed.
- **A light server page, not the app.** `ShowShell` + `ShowView` (`src/components/shows/`):
  no `(desktop)` layout, no client code. Everything is in the server HTML: a native
  `<audio controls preload="none">` (archive.org, then the mirror), facts, AI summary,
  related lists (same guest, same day in other years, same category; bounded, every link
  a real page). The root layout's boot screen is hidden by a `<style precedence>` hoisted
  into `<head>` (`NO_BOOT_CSS`); without it the page sat under `#app-loading` for 6 s, and
  forever without JavaScript. Class hooks are `hd-show-*` for the looks.
- **Head and structured data** (`src/lib/shows/metadata.ts`, `jsonld.ts`): title
  "Subject with Guests · Programme, Date", description from programme, date and summary
  (≤160), canonical, Open Graph, Twitter card; a `next/og` card per page
  (`opengraph-image.tsx`); `PodcastEpisode` (partOfSeries, datePublished, ISO duration,
  AudioObject with the archive.org URL, Art Bell as `creator`, guests as `actor` only when
  `guestPeople()` is sure they are people) and `BreadcrumbList`.
  `scripts/lib/jsonld-check.mjs` holds them to the schema.org vocabulary.
- **Pages render on first request and are cached until the next deploy**
  (`generateStaticParams` returns `[]`; about 175 KB of disk per crawled page). **Share
  cards are drawn per request** with a week-long `Cache-Control` (`CARD_CACHE_CONTROL`),
  never stored. The build renders neither.
- `src/app/sitemap.ts` lists every show, guest and topic page, `/topics`, the Request Line and every station day's Tonight page from 2026-09-11 (`FIRST_STATION_DAY`; never a moment); `public/robots.txt` disallows
  `/api/`, `/scanner`, `/search`, `/look`.
- **`npm run check:seo -- <url>`** (`scripts/seo-check.mjs`) crawls robots, the sitemap and
  a fixed sample of pages as raw HTML (no JavaScript) and fails on missing tags, invalid
  JSON-LD, content absent from the server HTML, any internal link or share image not 200.
  Run it against a local build before a push that touches a page, and against production after a deploy.
- **Sharing** (`docs/show-pages.md`, "Sharing"): Share sends `/show/<slug>` (the old
  `/library?ep=` link until the slug arrives, and old ones keep working); **Share this
  moment** in both looks' players sends `/show/<slug>?t=<seconds>`. The moment page is
  `force-dynamic` (no ISR file per second), canonical the plain page, its own card
  ("Starts at 1:23:45"); the plain page stays static whatever the query. Sources carry
  `#t=` (plays there without JavaScript); "Open in High Desert" carries `t`
  (`/library?show=<key>&t=`), and `startMoment()` plays only while
  `navigator.userActivation.isActive`, else says "Press play to start at …"; the next
  start of that show begins there through `takeRequestedStart()`
  (`src/audio/requested-start.ts`), read synchronously in `playEpisode()` between
  `liveStartFor()` and `startPositionFor()`.
- **First screens:** every show/guest/topic/Tonight page says what High Desert is in one
  line with **Listen to the station now** and **Browse the Library**; show pages lead
  with a one-tap Play (`ShowPlayButton`, hidden by a `<noscript>` rule) and list their
  topics.
- **Topic pages** (`src/lib/topics/`): every category but Other, 29 curated subjects
  (Mel's Hole, Area 51, …, phrase-matched), and tags on at least 10 shows that are not
  generic, a category, a person or covered by a subject; at least 3 shows each. A tag
  crossing the threshold fails `topics.test.ts` until it is named or called generic.
  **`data/topic-slugs.json` is add-only like the show slugs: after a catalog change run
  `node scripts/gen-topic-slugs.mjs` and commit.**
- **Tonight** (`src/lib/tonight/`, `src/services/live/tonight.ts`): read-only over
  `live_days` except freezing *today* (the station's own rule); a future day only once
  frozen; without a database it lists the date's broadcasts. Sitemap: every station day from `FIRST_STATION_DAY` (2026-09-11).
- **Search Console is verified** (2026-10-15) as a Domain property by a DNS
  TXT record at Hostinger, and `sitemap.xml` is submitted. The token is in
  `deploy/google-site-verification.txt`; `highdesert-status`'s `search` line
  WARNs if the record disappears or changes (verification lapses without
  it). The digests of 2026-11-02 and 11-09 remind Jackson to send a
  screenshot of the Pages report (`REMINDERS` in `scripts/digest.mjs`).
- **`GOOGLE_SITE_VERIFICATION`** (in `/root/.high-desert.env`) adds Search Console's meta
  tag. It is read at **build** time (the root layout is static); `deploy.sh` passes that one
  variable through to the build. Absent or malformed: no tag. A DNS TXT record (Domain
  property) needs no code at all and is the recommended route.

## Conventions

- **Import alias:** `@/*` → `./src/*` — all internal imports use `@/`
- **Components:** PascalCase files, named exports (pages/layouts use `export default`)
- **Hooks:** `use` prefix, camelCase (`useAudioPlayer.ts`)
- **Stores:** `use` + Name + `Store` (`usePlayerStore`)
- **Services/Utils:** kebab-case (`file-scanner.ts`, `rate-limit.ts`)
- **CSS classes:** prefixed kebab-case (`w98-`, `glass-`, `crt-`, `animate-`)
- **Client components:** `"use client"` directive at top
- **Zustand selectors:** always use selector functions to minimize re-renders
- **Class names:** always use `cn()` utility (`@/lib/utils/cn`) for conditional Tailwind classes
- **Dexie queries:** `useLiveQuery` from `dexie-react-hooks` for reactive reads
- **Error boundaries:** `DBErrorBoundary` around Dexie-dependent UI, `WidgetErrorBoundary` around individual widgets
- **Virtual scrolling:** `useVirtualList` hook with fixed `itemHeight` and `containerRef`

## Type scale and the text ramp — read before styling text

**Tailwind v4's font-size namespace is `--text-*`, not `--font-size-*`.** The theme
block in `src/app/globals.css` originally registered the scale under `--font-size-hd-*`,
which v4 silently drops — it emitted no CSS at all, so all 694 `text-hd-*` usages across
57 files were inert and every character on the site rendered at the inherited body size.
Colors from the same `@theme` block compiled fine, which is what made it invisible for
so long. If you add a size, add it as `--text-hd-*` **and verify it in the built CSS**:

```bash
C=$(ls -t .next/static/chunks/*.css | head -1)
grep -o '\.text-hd-[a-z0-9]*' "$C" | sort -u    # must list your new token
```

- **Eight steps:** `micro` 11 · `caption` 12 · `body` 14 · `title` 16 · `h3` 20 ·
  `h2` 28 · `display` 36 · `hero` 48. Each ships a line-height. Prefer the semantic
  names; the legacy numeric names (`text-hd-10`, …) are aliases onto the nearest step
  and the number no longer reflects the rendered size.
- **Every step carries `--hd-text-scale`**, the user's text-size setting. Anything that
  hard-codes a pixel height for text content must scale with it — use
  `itemHeightFor()` / `currentItemHeight()` from `@/hooks/useTextScale` rather than a
  literal. Fixed row heights are why "Extra Large" made virtual-list rows overlap.

**Three-tier text ramp — never take text below `/85` opacity.** `--color-bevel-dark`
is `#9AA0AE`; at `/85` it is 4.89:1 on `raised-surface`, the darkest surface it sits on.
Below that it fails AA. Use color, not opacity, for hierarchy:
`text-desktop-gray` (primary) → `text-bevel-dark` (secondary) → `text-bevel-dark/85` (dim).

`--color-title-bar-blue` (`#000080`) and `--color-highlight-blue` are **chrome fills**
— title bars and selection. As text on the dark surfaces they measure ~1.1:1, i.e.
invisible. For blue *text* use `--color-signal-blue` (`#6BA3F0`, 7.0:1).

**One colour, one definition.** `src/app/globals.css` holds the canonical palette as
`--hd-*` custom properties. The Tailwind `@theme` tokens (`--color-*`) and the Win98
chrome tokens (`--w98-*`, in `src/styles/win98.css`) are both *aliases* over it — never
write a hex in either. Seven values were previously declared independently in both
namespaces, and four dark-bevel hexes appeared as raw literals a dozen times each
inside `win98.css`.

**No hex anywhere else in `src/`** (HD-036) — `src/lib/__tests__/no-raw-hex.test.ts` fails
on one, on a `var(--hd-*)` that is not defined, and on palette drift. Where `var()` cannot
reach — canvas `fillStyle`, `next/og`, `<meta theme-color>`, the boot splash,
`global-error.tsx` — import `PALETTE` from `src/lib/palette.ts`, a copy the same test holds
key-for-key equal to globals.css. A new colour is a new `--hd-*` property first.

Use `min-h-touch` / `min-w-touch` (44px, `--spacing-touch`) for tap targets rather than
a literal. Note the common pairing `min-h-touch md:min-h-0` — the floor is a mobile
concern, so measure it at a mobile viewport or you will read `0px` and think it broke.

## Meters and visualizers: `src/audio/levels.ts` (2026-10-12)

Every visualizer (the Oscilloscope in both looks, the Winamp window included)
reads its levels from **`getLevelSource()`** and mounts with
**`retainLevels()`**, never from the engine. Desktop and Android get the
engine's AnalyserNode as before. **iOS gets the level tap**
(`src/audio/level-tap/`): the player's element is never routed through Web
Audio there (it stops the show on the lock screen), so the tap Range-reads the
bytes around the playhead from the URL the element plays (`/mirror/...` or
archive.org, which sends CORS on every hop; it keeps the storage node that
answered), aligns to a frame past the ID3 tag (`mpeg.ts`), decodes the chunk in
an **OfflineAudioContext** (no device, no audio session, nothing on the lock
screen) and answers the AnalyserNode calls at the element's `currentTime`.
It fetches **only** with a visualizer mounted, the page visible, the show
playing with `readyState >= 3`, and not during the live station's bridge;
`halt()` on `visibilitychange` hidden and on `pause`. Never give it a second
media element and never let it touch MediaSession. Before this, iOS had no
analyser at all: Milkdrop painted one black frame and parked, the VU needles
sat at zero. Tests: `e2e/meters.spec.ts` (reads the VU needle off the canvas,
iPhone UA and not, both looks, archive.org, mirror, repaired, pause, show
change, lock screen; `E2E_REAL_ARCHIVE=1` for the real redirect chain),
`src/audio/level-tap/__tests__/`, `src/audio/__tests__/levels.test.ts`,
`src/hooks/__tests__/oscilloscope-levels.test.tsx`; mutations `level-tap-*`,
`mpeg-*`, `spectrum-*`, `levels-*`, `oscilloscope-*`.

## Playback — read before touching the play path

**`loadEpisode()` does not touch the `<audio>` element.** It is a Zustand setter.
The only things that assign a real `src` are `playEpisode()` and `primeEpisode()` in
`src/hooks/useAudioPlayer.ts`. The restore-on-revisit path called only `loadEpisode`,
so the player rendered a live ▶ over an element with no source and `togglePlay`
returned at `if (!audio.src)` — silently. No error, no toast, no log. A listener hit
this every time they came back, worked around it by picking a different show, and
concluded it was their own mistake. Regression test:
`src/hooks/__tests__/restore-play.test.ts`.

- **There are two start paths, and anything a play must do has to happen on both.**
  `playEpisode()` covers the library click, the queue advance and the radio dial.
  `togglePlay()` covers the restored player: once `primeEpisode()` has given the element
  a `src`, pressing ▶ plays it in place and never goes near `playEpisode`. That second
  path shipped reporting nothing — no `reportPlay`, no local `playCount` — so a listen
  started from the remembered show wrote no leaderboard entry, no permanent event, and
  no `active_sessions.episode_id`, which is what made it absent from "on air" while it
  was audibly playing. Both now call `countListen()`; `firstPlay` distinguishes it from
  an ordinary pause/resume, which is the same listen continuing. Regression test:
  `src/hooks/__tests__/play-reporting.test.ts`, which mounts the real hook precisely
  because a test that re-implements `togglePlay` would reproduce the omission and pass.
- **Nothing outside `src/audio/engine.ts` touches the player's element.** It is a detached
  `new Audio()` that is never in the DOM, so `document.querySelector("audio")` finds nothing —
  the sleep timer "paused" that way for months while the show played on, and bookmark
  markers moved only the store's `position`, which the next tick overwrote. Use
  `pauseEngine()` / `seekEngine(t)`. `seekEngine` at `readyState` 0 holds the seek and applies
  it on `loadedmetadata` — a `currentTime` written before there is a timeline is discarded.
  ESLint bans `querySelector("audio")` and every `src = ""` spelling in `src/` (the proof
  is `src/lib/__tests__/eslint-rules.test.ts`).
- **Every start takes a generation token** (`src/audio/play-session.ts`). Picking show B
  while A is loading makes A's `play()` reject with `AbortError` and queues an `abort`
  event that fires *after* B has started; both used to be charged as failures — to B.
  A superseded start's rejection, any `AbortError`, and `abort` itself are not failures.
  The layout's `hd:play-episode` handler takes its token *before* its awaits (metadata,
  OPFS) and passes it to `playEpisode`, so a slow A cannot land on top of B.
- **A listen is counted once per source** (`markListenCounted`), which is what separates
  a first ▶ on a restored show from resume. `togglePlay` dispatches on the store's
  `playing`; MediaSession play/pause call `resumePlayback`/`pausePlayback` explicitly,
  never a toggle — a headset "pause" must never start audio.
- **Finished means start over.** `startPositionFor()`: within 30 s of the end or past 95%
  starts at 0, and `ended` clears the saved position. Position is saved every 30 s
  (`POSITION_SAVE_MS`) plus on pause, `visibilitychange` and `pagehide`; the save is
  caught, never an unhandled rejection. Saves go to the `progress` table through
  `writeProgress()`, and every start reads the position synchronously with
  `positionOf(fileHash)` — never from the episode row (see "Playback position lives in
  `progress`").
- **Only the leaves in `PositionReadouts.tsx` subscribe to `position`.** It changes four
  times a second; `AudioPlayer` selecting it re-rendered the whole player per tick.
  `render-pressure.test.tsx` holds that.
- **The radio scan preview is `src/audio/scan-preview.ts`**, its own elements, not the
  player's. A new preview clears every timer of the last one (its fade-out used to fire
  on the *new* preview), stops with `removeAttribute("src")` + `load()`, and seeks on
  `loadedmetadata`.
- **`primeEpisode()` sets `preload="none"` before assigning `src`.** Keep it that way.
  At `"metadata"` every page load fetches the head of a show nobody asked for, and a
  VBR rip with no Xing header can make that most of the file. `play()` loads
  regardless of `preload`, so the button still works.
- **Never `audio.src = ""`.** It resolves against the document URL, so the browser
  fetches the HTML page and tries to decode it as audio. Use `removeAttribute("src")`
  then `load()`.
- **`play()` before `resumeContext()`.** The analyser context is not required for
  playback; awaiting it first put a task boundary between the tap and `play()`, which
  is how Safari decides a call was not user-initiated.
- **The watchdog owns failure policy** (`src/audio/playback-watchdog.ts`): one silent
  retry, then `loadState: "failed"`, which raises `PlaybackErrorDialog`. Its load
  deadline resets on every `progress` event — it catches *silence*, not slowness.
  Timing out a slow-but-moving download would throw away everything buffered, the same
  mistake the service worker's navigation handler once made.
- **A watchdog that cannot see must not report, and must never interrupt sound.** Both
  learned the hard way. Because the media listeners were never attached (above), no
  `progress` ever reset the deadline and no `canplay` ever settled the attempt: every
  load ran the full 12s out, the retry tore down an element that was *streaming fine* —
  the show cut out and restarted, or on iOS stopped dead — and a timeout was recorded
  against a working episode. All 32 rows in `playback_failures` were written that way,
  with `recovered: false` on every one, because `noteReady()` was unreachable. So:
  `noteListenersAttached()`/`noteListenersDetached()` bracket the media-events install,
  and `armWatchdog()` **refuses to arm** without them rather than supervising blind;
  and before the deadline or stall clock acts it checks `!paused && readyState >=
  HAVE_CURRENT_DATA` and stands down if the show is audibly playing. `paused` alone is
  not enough — `play()` clears it synchronously, so a dead load also reports unpaused.
- **The retry must not start audio nobody asked for**, and **must not be attempted when
  `play()` cannot succeed.** It runs in a timer callback twelve seconds after the tap, so
  the transient activation that authorised the original `play()` has almost always
  expired. It therefore checks `navigator.userActivation.isActive` *before* touching the
  element: no activation and a `play()` would be needed → **skip the retry entirely** and
  `giveUp`, raising `PlaybackErrorDialog`, whose *Try Again* is a real gesture and can
  succeed. Tearing the element down first and discovering the refusal afterwards leaves
  the listener with no audio, no buffer and (before `setFailureHandler` was wired) nothing
  on screen. This is **not an iOS special case** — Safari refuses loudest, but a `play()`
  that cannot succeed should not be attempted anywhere. Where the API is unsupported
  (Safari <16.4, Firefox <121) it is treated as *permitted*: guessing "no" would disable
  the retry where it may work, and guessing "yes" costs at worst a rejected `play()`,
  which is terminal and raises the same dialog seconds later. Skipped retries record
  `retried: false`, so they are distinguishable in the data from retries that ran and
  did not help. It also still only re-issues `play()` if the element was unpaused when
  the deadline fired.
- **`PlaybackErrorDialog` is mounted in `(desktop)/layout.tsx`, not inside `AudioPlayer`.**
  Keep it there. It must render in every player state — including ultra-mini, where the
  error banner went missing once — and on pages that draw no player chrome at all.
- **`useAudioPlayer` is mounted twice** — by `(desktop)/layout.tsx` and by
  `AudioPlayer.tsx`, whose `return null` sits after the hooks. Global listeners,
  timers and intervals go through `withGlobals(key, install)` so they install once.
  Anything new with a side effect outside React must too, or it runs twice: that is why
  the queue used to skip two tracks at the end of a show.
  **The count is per `key`, and that is not a detail.** It was one shared module-level
  counter across all five call sites, so `count === 1` was true for exactly one call in
  the whole hook — the position timer, which happens to be declared first — and the
  other four installs *never ran, in any browser, ever*. The media element listeners
  were never attached, `setFailureHandler` was never installed, position was never
  persisted and the unload beacon never fired. A new call site needs a new key in
  `GlobalKey`; reusing an existing one silently disables one of them.
  Regression test: `src/hooks/__tests__/global-listeners.test.ts`, which mounts the hook
  **twice** — the way production does — and asserts each subsystem installs exactly once.
- **`useAudioPlayer.ts` is the start/stop/seek surface and the wiring; the rest is in
  `src/hooks/player/`** (HD-018): `globals.ts` (`withGlobals`, `GlobalKey`),
  `play-session.ts` (`openListen`/`armListen`/`countListen`, the watchdog's failure and
  failover handlers — not to be confused with `src/audio/play-session.ts`, the start
  token), `media-events.ts` (the element listeners), `persistence.ts` (position tick,
  position saves, unload flush, `POSITION_SAVE_MS`) and `media-session.ts`. Every
  `withGlobals` call stays in `useAudioPlayer.ts`, one per key, so the keys can be read
  in one place; the modules export plain `install*()` functions that return their teardown.
- **The service worker must never see media.** `public/sw.js` returns early for
  `Range` requests, `destination === "audio"`, archive.org hosts and audio extensions.
  It never cached audio, so `respondWith()` bought nothing while defeating native
  byte-range handling and turning network failures into a body-less 504 that the
  element reports as "source not supported".
- **Offline, an API call gets JSON, never an empty 504** (HD-034). The worker keeps the
  last good answer of a same-origin `GET /api/stats/*` and serves it only when the network
  fails; anything else under `/api/` offline is `503 {"error":"offline"}`. **Presence is
  never cached** — `/api/stats/now`, its alias `/active` (and `/export`) are on
  `API_NEVER_CACHE`, and a `no-store`/`private` response is never kept: a stale on-air list
  is worse than none. POSTs and the archive.org proxies are never cached. Tested against
  the real script in `src/lib/__tests__/service-worker.test.ts`.

## archive.org outage mirror — read before touching `src/audio/sources.ts` or `services/mirror/`

Every show streams from archive.org. When archive.org is down — it has had
multi-day outages — the site used to be a dead player. There is now a fallback,
and it is deliberately modest: a bounded cache on this server, not a copy of the
archive. Feasibility, measurements and sizing: `docs/torrent-mirror-feasibility.md`.

- **archive.org's own torrent covers none of the episodes.** Its item torrent
  (btih `ec92fe3b…`, 2024) holds two metadata files and zero MP3s, and nobody
  outside seeds anything here (measured against a control that found hundreds of
  peers). So `scripts/build-torrent-index.mjs --hash` builds **one single-file
  torrent per episode** from the bytes archive.org serves — 256 KiB pieces, BEP-19
  `url-list` = the archive.org file URL, so archive.org is the webseed while it is
  up. Infohashes are deterministic. Output: `data/torrents/episodes.json`
  (`fileHash → {infohash, length, pieceLength}`, committed) and the `.torrent`
  files in `/var/lib/highdesert-mirror/torrents` (not committed, 1,413 of them;
  `deploy-mirror.sh` refuses if any indexed one is missing). Resumable, ≤2 req/s.
- **There is no mirror process: nginx is the mirror** (since 2026-09-25). The
  webtorrent gateway held ~47% of a core seeding to a swarm with no one in it and
  was removed — why, and how to bring it back, in
  `docs/torrent-mirror-feasibility.md` §6. `services/mirror/lib/nginx.mjs` renders
  two includes, installed to `/etc/nginx/highdesert-mirror/` by
  `deploy-mirror.sh` and pulled into the vhost:
  - **Repaired first** (2026-10-11): `try_files /repaired/{fileHash} /pins/{fileHash}
    @fill`. A show whose archive.org file changes channels or sample rate midstream
    (Chromium refuses it) is re-encoded once to one layout by `scripts/repair-episode.mjs`
    and served from `repaired/`; the original is never touched. Recorded in
    `src/data/repaired-episodes.json` (sizes, digests, segments, the ffmpeg line),
    which `deploy-mirror.sh` checks against disk, the warm job reads (a repaired show is
    never pinned) and the player reads: **a repaired show plays from the mirror only**
    (`resolveSources`, `isRepaired`), the scan preview and a primed show too. List and
    why: `docs/broken-episodes.md`, "Repaired, not pulled".
  - **Pinned** `/mirror/{fileHash}` is `/var/lib/highdesert-mirror/pins/{fileHash}`
    served straight off disk (nginx's own 206/416, no app CPU).
  - **Unpinned** is filled from archive.org through `proxy_cache`
    (`/var/cache/highdesert-mirror/proxy`, 1 MiB `slice`s keyed `$uri$slice_range`,
    `max_size=20g`, `min_free=10g`). The fill goes through a second server on a unix
    socket that rewrites to `/download/{identifier}/{file}` and follows the 302 to
    the storage node — only to `*.archive.org` over verified TLS. Two hops because an
    `error_page` redirect clears a slice subrequest's context. Nothing of the listener
    goes upstream (`proxy_pass_request_headers off` on both hops). With archive.org
    down the fill has no source and fails; outage mode refuses those at the tap.
  - **A storage node's 500 is retried per slice** (2026-10-11). archive.org's nodes
    answer ~3% of slice Range requests with a bare 500, and nginx 1.24's slice module
    aborts the whole response on a non-206 subrequest: a full-file request was cut at
    13.6 MB of 100.9 MB. The fill upstream is the same socket three times
    (`max_fails=0`) with `proxy_next_upstream … http_500 http_502 http_503 http_504`,
    3 tries in 30 s. `test/nginx.test.mjs` (`FLAKY`) streams a file whose stub fails
    two slices once each, to the end. It did not explain the Android mirror timeouts
    (none of 22 in the log window hit a slice abort).
  - **When `/download` fails, the collection's own server** (2026-10-11,
    `docs/archive-outage-2026-10-11.md`). A 5xx from `/download` or the node it
    names goes to `@hd_mirror_direct`: `https://{d1}{dir}/{file}` from
    `data/archive-items.json` (`scripts/archive-items.mjs`; re-run and commit if a
    collection moves). That day `/download` sent everyone to one failing cache node
    and then served "Sorry, we're kinda busy" while the item's servers answered.
    The health probe checks the metadata API, so it said up throughout; that is
    deliberate now (outage mode would refuse shows the fallback can serve).
  - **The allowlist is a directory**, `/var/lib/highdesert-mirror/catalog/{fileHash}`,
    one file per catalog episode (its magnet JSON, generated by `build-static.mjs`).
    Not a `map`: 200-byte keys need `map_hash_bucket_size`, which
    `conf.d/sogojet-prerender-map.conf` has already fixed by declaring a map first
    — a later one is a "duplicate" error that takes down every site's config.
  - **Its access log records `range=`, `rt=` (`$request_time`) and `cache=`**
    (log format `hd_mirror`, pinned and fill locations alike), so a failover that
    did not recover can be read from the log rather than inferred (row 587).
  - `test/nginx.test.mjs` starts a **real nginx** from the rendered text against a
    stub archive.org (302 included) and asserts "from disk" and "from cache" as *no
    request reached the stub*. It fails in CI if nginx is missing.
- **Warm cache:** `highdesert-mirror-warm.timer` (04:10 UTC, `CPUQuota=10%`,
  `Nice=19`, idle I/O) pins the most-played episodes by 90-day `play_events`, whole
  files only, up to 15 GB: a plain HTTP download into `/var/lib/highdesert-mirror/tmp`,
  **verified against the `.torrent`'s piece SHA-1s**, then renamed into `pins/` — a
  name in `pins/` is always a whole, verified episode. **Pins come first**: an
  episode that fell out of the top is unpinned only to make room for a top one
  that then fits (or once every top one is present), never up front and never on
  an empty play list; nginx's `min_free` (12g) sits 2 GB above the warm floor so
  fill slices give way before any pin. The disk does not currently hold the
  15 GiB target (`docs/torrent-mirror-feasibility.md`, "The real disk budget"),
  and `highdesert-status`'s `warm` line WARNs while pins are below it. It rewrites
  `/var/lib/highdesert-mirror/manifest.json` **atomically** (temp + rename: nginx may
  be mid-send). **It skips itself while hypervisor steal is above 20%** and records
  why in `/var/cache/highdesert-mirror/warm-status.json`.
- **The torrents stay, as verification and magnets.** `/mirror/magnet/{fileHash}`
  is the static catalog file; the magnet's webseed is archive.org, with no `x.pe`
  (nothing here seeds).
- **Client failover** (`src/audio/sources.ts`, `playback-watchdog.ts`,
  `useAudioPlayer.ts`, `src/hooks/player/play-session.ts`): `resolveSources()` is archive.org then
  `/mirror/{fileHash}`; only catalog episodes have a mirror, and while archive.org
  is known down a show the manifest lacks has none (outage mode, below). On a watchdog
  `network-error`, `stall` or `timeout` — **never `play-rejected`**, which is the
  browser refusing sound, and never decode/empty-media, which are about the bytes —
  the watchdog calls the failover handler *before* its retry: the **same element**
  gets the mirror `src`, the position is restored with `seekEngine`, `play()` is
  re-issued, and **no second listen is counted** (`isListenCounted()`). The
  failover spends the retry: a mirror that also fails raises the dialog, it does
  not go back to archive.org. A mid-show media error (code 2/4) on an archive
  source goes through the same path. If `play()` after the swap is refused (iOS,
  activation expired) the failure is `play-rejected` and `PlaybackErrorDialog`'s
  *Try Again* is the gesture — the same rule as the retry. (A `NotSupportedError`
  from `play()` is about the source, not permission: `playRejection()` routes it
  as a `network-error`, so it fails over.)
  Two iOS failovers did not recover on 2026-09-27 (rows 541, 545); both are
  held in `mirror-failover.test.ts`. **A failover nobody was waiting for**
  (the element was paused, e.g. a primed show) settles quietly (`primed()`),
  never judged by the stall clock while iOS has stopped loading. **While a
  failover's `play()` is pending and the page is hidden**, the deadline and
  stall timers re-arm instead of judging (`deferWhileHidden()`): iOS holds a
  background `play()` until the phone wakes, and a frozen timer firing on wake
  gave up on a mirror that was about to play.
  **Why 62 failovers did not recover** (2026-10-01 to 10-12, fixed 2026-10-12,
  `mirror-failover.test.ts` and `playback-watchdog.test.ts`, "why 62"):
  - a restored show's ▶ (`resumePlayback`) now ignores a rejection for a source
    the element has left, as `playEpisode` always did; archive.org's stale
    NotSupportedError was failing the mirror it had just moved to;
  - the failover handler resolves with what its `play()` rejection was
    (`playRejection`): the mirror's NotSupportedError is a `network-error`,
    not a refusal;
  - after a failover the mirror has **`FAILOVER_FIRST_BYTE_MS` (30 s)** to send
    its first byte, with no stall verdict before it: an unpinned show's first
    slice is filled from archive.org first (9 to 23 s measured);
  - a deadline or stall clock that fires more than twice its budget late was
    frozen with the page and starts again instead of judging (`frozen()`);
  - once the watchdog has moved a show to the mirror (`useOutageStore.failedOver`),
    Try Again and the next start of that show go to the mirror
    (`currentStartPlan`), never back to archive.org.
- **The health probe's verdicts are re-probed on different clocks** (`src/services/archive/health.ts`):
  up after 5 min, **down after 30 s**, and a probe that failed to reach *our* server
  is not a verdict at all. It used to hold any failure for 5 minutes, and with the
  mirror that would route every play away from a recovered archive.org. Verdicts are
  published to `useOutageStore`; `archiveKnownDown()` reads it and is synchronous —
  the play path must not await before `play()`. While it is true, starts go
  straight to the mirror, or are refused (outage mode, below).
- **`source` is recorded everywhere a play or failure is** (player store,
  `/api/stats/play`, `/api/playback-event`, `play_events.source`,
  `playback_failures.source`). The UI says so: **VIA MIRROR** (`MirrorBadge`) in the
  desktop status bar and the mobile player, and a **Magnet link** action in the
  episode sheet.
- **Deploy:** `bash scripts/deploy-mirror.sh` — stages `/opt/highdesert-mirror.next`
  (no dependencies), generates the catalog directory and the nginx includes, runs
  the idempotent migration (`migrate.mjs`: the gateway's verified files renamed into
  `pins/`, nothing re-downloaded, nothing it cannot place removed), installs includes
  + vhost with `nginx -t` first, installs the warm units, removes the old
  `highdesert-mirror` unit and the torrent ufw ports, then runs `verify.mjs` through
  `https://highdesert.space` (manifest 200 + 304, pinned 206 + 416, an unpinned fill,
  a magnet, a 404), rolling back on failure — to the torrent gateway if that is what
  `/opt/highdesert-mirror.prev` holds (`migrate.mjs --reverse`). The app's
  `scripts/deploy.sh` does not touch the mirror.
- **Outage mode** (`src/stores/outage-store.ts`, `src/audio/outage-gate.ts`). When
  the health probe says archive.org is down, the app says so and stops pretending
  every show can play: a banner (**"archive.org is down. Playing from the High
  Desert mirror."**), a **MIRROR** mark on rows the manifest lists, the rest
  dimmed (greyscale and a lower text tier — never opacity), and a **"Playable
  now"** filter that turns on for the outage and off after it. A start the
  mirror cannot serve is **refused at the tap** by `refuseIfUnavailable()` —
  synchronously, from the manifest in memory — and `OutageDialog` offers three
  shows it holds (same guest, then category, then year: `suggestPlayable`). All
  three start paths go through it: the play-episode handler (before it queues,
  `admitRequestedStart`), `playEpisode()` and a restored show's first ▶. It used
  to wait out the (since removed) gateway's 15 s first-byte budget and fail anyway.
  - **One verdict, everywhere.** `archiveKnownDown()` is the store's verdict —
    held until a probe says otherwise — not "a fresh down": a start must agree
    with the banner on screen. `useOutageMonitor` (mounted once in the layout)
    keeps it current: a probe on load, every 30 s while down, every 5 min while
    up, and on returning to a hidden tab. The banner and dimming clear when a
    probe says up — there is no timer.
  - **A null manifest is "unknown", never "empty".** Down with no manifest, a
    start goes to the mirror to find out. The manifest is read the moment outage
    mode begins and kept in localStorage, so a page loaded mid-outage marks rows
    before its own fetch returns.
  - **The manifest's ETag is nginx's** (mtime-size), not its `version`. The client
    stores the response's `ETag` and sends it back **verbatim** as `If-None-Match`
    (`src/services/mirror/manifest.ts`); sending `"version"` never matches.
  - **Local files are never marked or refused** — they never needed archive.org.
  - **Slow is not down** (2026-10-12). When the watchdog moves this tab's show
    to the mirror with no outage verdict (archive.org answers its probe while
    `/download` stalls), a quiet notice says **"archive.org is slow right now.
    Playing from the High Desert mirror."** (`SLOW_COVER_TEXT`,
    `OfflineIndicator`), from `useOutageStore.failedOver` and `selectSlowCover`:
    only while that same show plays from the mirror, never with the outage
    banner, nothing dimmed or refused. A listener in Perth took the silent
    failover for the show ending.
  - Tests start from `archiveUpFixture` / `archiveDownFixture`
    (`src/test-support/outage.ts`); `e2e/chaos-mirror.spec.ts` runs it on production.
- **Status:** `highdesert-status` has `memory` (MemAvailable / MemTotal; WARN <15%,
  FAIL <5%; `docs/memory-2026-09-28.md`), `steal` (30-min mean; WARN >20%, FAIL >50%),
  `mirror` (the manifest answering through the site with ≥1 pin — FAIL otherwise;
  pinned count and bytes, fill-cache size, 24h mirror plays; WARN if the retired
  `highdesert-mirror` unit is running again), `cpu` (every High Desert unit's
  15-minute mean from cgroup accounting, sampled each minute by `hd-cpu-sample.timer`
  in `/root/vps-tools`; FAIL above 10% of a core), `warm` (last run; WARN when
  stale >36h, skipped for steal, or with failed fetches) and `disk` (free space
  on `/`: WARN under 10 GB, FAIL under 5 GB (15 until 2026-10-16); the warm job needs 10 GB free and a
  build about 1 GB; `disk-sweep --dry-run` lists what can go) lines.
- **The `failures` line is starts lost, the trailing 7 days** (2026-10-12): lost
  (failed and not rescued by the retry or the mirror, repeats in one tab
  counted once) over plays, the same accounting as the release line, with
  rescued starts and all failure rows beside it. It used to divide every
  failure row by plays: 21.5% for a week that lost 5.3%, because 161 of its 230
  rows were starts the mirror rescued. The `release` line's window is the 7
  days after the release; once they are over it says "window closed" and
  points at `failures` for the current week.

## Live station — read before touching `src/lib/live/`, `src/audio/live-*` or `/api/live/*`

High Desert Live is one 24/7 station everyone hears at the same second. The
server publishes a program; every tuned-in client plays the same slot at the
same offset, computed from a synced clock.

- **The day** (`buildDay` in `src/lib/live/schedule.ts`, pure) runs midnight to
  midnight **Pacific** — 23 h and 25 h on the DST dates (`pacificDayBounds`).
  Every airable episode whose air date is today's month-day, any year, **oldest
  first** (29 Feb folds onto 28 Feb in non-leap years), then fan favorites by
  community plays (`episode_plays`), skipping any that aired in the previous
  **30 days** (14 until 2026-10-29), any whose own date comes up in the next
  30 (held for it: 2013-10-28 aired on 27 and 28 October 2026), and any
  holiday show out of its season (`showSeason`, below); a favorite whose
  guest was on today or the 2 days before waits behind one whose was not
  (`guestsOf`). Ties break on `fileHash`, so the program is a function of the
  date and the inputs. Slots are end to end with an **8 s station ID** between
  each; the last is **cut at midnight** and the next day starts at its own
  midnight. A catalog too small to fill a day relaxes the repeat rule rather
  than leave dead air.
- **Frozen, not recomputed.** `frozenDay()` (`src/services/live/days.ts`)
  builds a day once, under `pg_advisory_xact_lock`, and stores it in
  `live_days (day, program jsonb)` — together with any missing days of its
  30-day window, so its history never shifts. A frozen day never changes when
  plays move; the returned program is the stored jsonb (`INSERT … RETURNING`),
  so the first answer is byte-identical to every later one. The program also keeps
  the top-200 `ranking` it was built from, for the outage swap.
- **The station never airs a file known to be broken** (2026-10-11). Two guards:
  - **Before air, frozen:** `highdesert-verify-live.timer` (15:20 UTC, Nice=19, idle
    IO, CPUQuota=10%) runs `scripts/verify-live-day.mjs`, which walks every frame of
    the next Pacific day's on-this-date shows and top favorites (a repaired show's
    mirror copy, a pin from disk, the rest from archive.org) into `audio_checks`. A
    file's bytes do not change, so a walked file is never walked again. `frozenDay()`
    swaps any slot whose file failed (`applyVerifySwap`, kind `verify-swap`) for a
    walked fan favorite, pinned first, slot times unchanged, and logs it.
  - **On air, at read time:** the breaker (`src/services/live/breaker.ts`). 3
    distinct clients tuned in to the show on the air (`live: true` on the failure
    report, `onTheStation()`), failing on it within 2 minutes with a kind about the
    file or the connection (never `play-rejected`/`handover-rejected`), cut it:
    a `live_overrides` row, applied by `applyOverrides` in every schedule read. The
    slot ends at the cut; after one station ID a walked favorite (`pickReplacement`,
    kind `breaker-swap`) plays to the slot's old end. The client key is HMAC'd in
    memory only. A tuned-in tab polls the schedule each minute and **follows a
    changed slot** (`followChanges` in `live-controller.ts`); a held tab is left alone.
  - The digest's **Station guard** section lists cuts and swaps and the walk's last
    run (stale past 36 h needs you).
- **Outage swap at read time**, never frozen (`applyOutageSwap`). While
  archive.org is down (`archiveVerdictPrompt`, the same memo as
  `/api/archive/health`), slots the mirror manifest (`LIVE_MIRROR_MANIFEST_URL`,
  default `https://highdesert.space/mirror/manifest`, memoised 60 s, last good
  kept) cannot play are replaced by playable ones — frozen ranking first,
  preferring one at least as long as the slot. **Slot times never move**: a
  shorter substitute ends early and the station ID fills the rest; a longer one
  is cut at the slot's end. A manifest that cannot be read leaves the day unswapped.
- **Synced playback** (`src/audio/live-controller.ts`). Clock: 5 samples of
  `/api/live/time`, keep the **min-RTT** one (`src/lib/live/time-sync.ts`);
  `serverNow()` in `useLiveStore`. Tune in plays at once on the known clock
  through the ordinary play path — `playEpisode()` asks `liveStartFor()` for
  the start position (station offset computed at the moment `src` is
  assigned), so the engine, watchdog and mirror failover are the same ones.
  Drift is checked every 10 s and corrected by one seek past **2 s**; a stall
  (`waiting` then `playing`) and returning to the tab resync at once. **The
  10 s check never seeks a buffering element** (`readyState` below
  `HAVE_FUTURE_DATA`) or one whose watchdog attempt is unsettled: each seek
  abandoned the range in flight, so a slow link never got ahead (row 586,
  2026-09-28). The correction waits for `playing` (`correctDrift`). At a
  slot's end (or the file's own `ended`, via `takeLiveEnded`) the station ID
  plays until the next slot starts.
- **The handover never pauses the element** (2026-09-28; `src/audio/engine.ts`,
  "The live station's bridge"). At 04:34:25 on 2026-09-27, phones with the
  screen off got `play-rejected` when the station paused for Web Audio static
  and then asked for the next show: iOS had ended the audio session in between.
  Now the station ID (`public/audio/station-id.mp3`) and a looped quiet file
  (`station-quiet.mp3`) play **on the same engine element**, and the next show's
  `src` is assigned over them; `isBridging()` keeps the media handlers and the
  position tick from reading the bridge as the show. The next show's first
  bytes are fetched `PREFETCH_LEAD_MS` (60 s) before the boundary, and
  MediaSession metadata follows each show (`mediaMetadataFor`). **A refusal is
  its own kind, `handover-rejected`, and counts** in `/api/stats/failures` and
  the release line like any failed start; the station then holds with `rejoin`
  set, `/live` shows **Tap to rejoin**, and ▶ anywhere (the lock screen's
  included) lands on the live second.
- **Pause holds, Leave leaves** (`docs/live-qa.md`). Pausing keeps the tab
  tuned with `paused: true` and stops the program timers, so nothing starts
  behind a paused player; any resume goes through `takeLiveResume()` at the top
  of `resumePlayback` and lands on the **live second** (or the show on now).
  A reload comes back held (`sessionStorage` `hd-live-tuned`). **Leave the
  station** (`leaveStation()`) tunes out *and* stops the player and deletes
  `last-episode-id`; picking another show or ■ Stop also tunes out. While tuned
  and not held the station owns the playhead and the speed: `seek()` and the
  speed button are refused with a toast (`liveLocked()`), and the station plays
  at 1×. Held paused is **not** live for the heartbeat, and the heartbeat beats
  whenever `tunedInLive()` flips. On a first visit the station plays a
  slot-made episode (no id) until the seed settles, then adopts the library row
  (`adoptRow`), which is what makes `last-episode-id` and history exist.
- **One listen per airing.** `claimLiveListen()` counts a slot once per client
  (keyed by slot start + file), so resyncs, stalls, failover and re-tuning never
  count again; the next show counts once.
- **Presence has one more figure, not another function.** A tuned-in tab's
  heartbeat carries `live: true` → `active_sessions.live_at` →
  `getPresence().live` → `/api/stats/now` `live`. The Live screen reads it from
  the shared feed like every other surface (`data-presence="live"`, with `data-live`).
- **On a phone, `<main>` pads the top safe-area inset** (2026-10-01).
  `viewportFit` is `cover`, and an in-app browser (WKWebView) or Chrome on iOS
  can draw the page under the status bar where Safari reports no inset: once
  Listen live left the top of the column, Call in sat under it. Call in is also
  sticky in the Live column. `e2e/live-qa.spec.ts` ("after Listen live, Call in
  and the call box stay on screen") sets `--safe-top` itself, since Playwright
  cannot set `env()`. Report sits beside a call's time as a small word with a
  44 px `::after` target.
- **A phone's first screen is one tap** (`docs/funnel.md`, `docs/live-qa.md`
  "The phone's Live screen", 2026-10-12, both looks). `PhoneLive` opens on the
  hero (`live-hero`): the show on the air, "with Guest · year", a one-line hook
  (`showHook()`, `src/lib/live/hook.ts`: the notable "why", else the summary's
  first sentence; **never invented**, nothing when the catalog has neither),
  time left, up next, "N tuned in now", and **one big button** in one place:
  **Listen live** (`live-tune-in`, `tuneIn()` inside the gesture), Leave while
  tuned, Rejoin live / Tap to rejoin while held. It is the only tune-in
  control on a phone (the Studio below has no buttons). Then the sticky Call
  in, the latest three calls (`phone-lines-preview`, drawn as the lines'
  blocks, your own tinted) whose tap opens the sheet,
  and the install card when it applies. Preview and sheet share **one**
  `useLiveChat` stream. A phone's first visit to `/` is sent straight to `/live`.
- **A phone says it once** (2026-10-12, both looks). The hero is the only place
  for ON AIR, the show on the air and Listen live. Under Call in, the calls and
  the install card comes **one strip** (`live-strip`, `PhoneStudio`): the
  station clock in PT (`live-clock`) and up next with its start time
  (`live-up-next`). Then **Tonight's log** on its own (`TonightsLog`), whose
  on-air row is a marker ("On the air now", no lamp, no title: `ProgramGuide
  marker`). The Studio window, with its own lamp and a log that named the show
  again, is desktop only (`Console`). Tests:
  `src/components/live/__tests__/live-phone-strip.test.tsx` (a control counts
  two on desktop) and `e2e/live-phone.spec.ts` (screenshots in
  `test-results/live-phone/`). Mutations: `live-phone-strip-*`,
  `live-guide-marker`, `live-strip-up-next`.
- **Phone Lines is a URL: `/live?lines=1`** (`src/lib/live/phone-lines.ts`).
  On a phone it is the Night tab and the Win98 taskbar button in Radio's old
  place (`md:hidden` / `tasksFor(isMobile)`), and Win98's Start menu and the
  manifest shortcut use it too. The Live screen opens the sheet (phone) or
  focuses the call box (desktop), then replaces the URL with `/live`.
- **UI.** `/live` (`src/components/live/LiveStation.tsx`): ON AIR sign, station
  clock (PT), now playing with time left, up next, the day's log
  (`ProgramGuide`, past/now/future), the live count, and the phone lines —
  `LiveChat` (the phone lines, below) beside the console on desktop,
  in a `visualViewport`-sized sheet on mobile (`LiveChatSheet`, keyboard-safe on
  iOS). The radio dial shows an ON AIR lamp (`LiveDialLamp`) that tunes in and
  swings the needle to the show's day; the strip marks it (`TuningStrip`, `onAirDay`).
- **Tests**: `src/lib/live/__tests__/`, `src/audio/__tests__/live-station.test.ts`
  (the real `useAudioPlayer`: two clients within 1 s, stall resync, no double
  count), `src/services/live/__tests__/live-days.db.test.ts` (freeze, window,
  concurrent freeze), `presence-clients.db.test.ts` (`live`), the UI tests in
  `src/components/live/__tests__/`, `e2e/live-qa.spec.ts` (what a real
  listener did: rename, lines, pause/resume/leave/refresh, the live count, at
  390 and on desktop), and `e2e/live.spec.ts` (two browser
  contexts within 2 s — run against a local build on the e2e database, the
  command is in its header). Mutations: the `live-*` ids in `scripts/mutate-check.mjs`.
- **The Request Line** (2026-10-14, `docs/request-line.md`). Listeners pick
  the show at **10 PM Pacific**, Art's airtime. Every new frozen day ends a
  show by 10 PM and marks the show on the hour `requestSlot` (`buildDay`;
  times from `src/lib/live/pacific.ts`, shared with the chat by symlink). At
  **6 PM Pacific** `live_request_night()` (one SQL function in
  `services/live/schema.sql`, so the app and the chat cannot disagree) locks
  the most voted pick, votes before 6 PM only, ties to the earliest; the
  schedule applies it at read time (`applyRequest`, before the outage swap
  and the breaker): the winner at 10 PM as `kind: "request"` with
  `request: {by, place, votes}`, the rest of the night after it, cut at
  midnight. Nobody nominated: the day as frozen. A failed read of the night is
  "no request", never a failed schedule. The chat posts "Tonight's request,
  from <name>, calling from <place>." once when it airs (`announced_at`).
  Nominate: Request it on show pages and the Library panel; vote and veto on
  `/request-line`; Live, Tonight's log and `/tonight` say it.
  **On a phone the note sits right under the hero's Listen live** with its
  own **Pick a show** button (`PhoneRequestNote`; below the calls and the
  clock nobody saw it), and while voting it counts the picks ("3 shows in
  the running, vote by 6 PM Pacific", `useRequestPicks`, today's only). It
  is in Win98's Start menu (Q) and at the top of Night's More sheet. Desktop: one link in
  the console. `e2e/request-line.spec.ts` screenshots the phone in both looks.
## Nothing spins forever, and the returning visitor (2026-10-14, after `docs/incident-2026-10-13/handoff.md`)

On 2026-10-13 the Library and Stats sat on gray rows for returning visitors:
two IndexedDB reads never answered, and a hanging read never throws.

- **Every Dexie wait times out into Retry.** Use `useTimedLiveQuery(querier,
  deps)` (`src/hooks/useTimedLiveQuery.ts`, `{value, timedOut, retry}`), never
  a bare `useLiveQuery` for something a screen waits on. Past `DB_WAIT_MS`
  (10 s) the screen shows `LoadTimeout` ("... is taking too long to load.
  Another High Desert tab or the installed app may be holding it." and
  Retry); Retry reads again, a late answer clears it by itself. The Library
  list, Stats, the status bar's count ("Not loading · Retry") and Mel's Hole
  use it. Tests: `timed-live-query.test.tsx` (including a second connection
  holding a readwrite, the way another tab does, with a control),
  `stats-page-timeout.test.tsx`, `e2e/db-hold.spec.ts` (a real second tab
  holding the database; Retry recovers once it lets go).
- **The returning visitor is checked on every deploy and every status run**
  (`scripts/returning-visitor.mjs`): a real profile on disk per browser
  (Chromium and WebKit), primed by the build still serving (the seed in
  IndexedDB, its service worker in control), then revisited after the swap.
  The Library must show rows and Stats numbers within 25 s, with no timeout
  and no page error. `deploy.sh` primes before the swap and revisits after the
  restart; a failed revisit (exit 1) **rolls back**, a revisit that could not
  run (exit 2) only warns. `highdesert-status`'s `returning` line runs `check`
  on the live site (profiles in `/var/lib/highdesert-returning/status/`) and
  reports the last deploy's revisit. `--hold` is the control: a second tab
  holds the database and the revisit must FAIL; on the build before this
  release it did. It never counts itself (`hd-not-counted`; a not-counted
  browser sends no heartbeat either).

## Long-lived tabs and the build that wrote each row (read before touching `src/services/build/`)

The station is left open for days. A deploy replaces the server, not the pages
already open, and on 2026-09-28 four of the first eight failures after a
release came from one tab still running the build before it.

- **Every play and failure row names its build.** The page's build is its
  document's `<meta name="hd-build">` (`src/lib/utils/build-id.ts`, the short
  SHA `deploy.sh` built); `reportPlay`/`reportPlaybackFailure` send it, and
  `play_events.build` / `playback_failures.build` store it (a CHECK holds it to
  a build id or NULL). `getFailureWindow()` returns `byBuild`, and status's
  `release` line counts only this release's builds (the release commit plus
  `.deploy/history`, which `deploy.sh` appends to), older builds apart
  (`docs/reliability-baseline.md`).
- **The release line's headline is starts the listener lost** (2026-09-28):
  failures the retry or the mirror did not rescue, over plays, held to 3%.
  Rescued starts stand beside it with their own count ("N rescued by the retry
  or the mirror"), in status and the digest, never held to the target. **Under
  300 plays it is counts, never a percentage** ("2 starts lost in 55 plays so
  far, no verdict until 300 plays"), and reads OK save one tripwire: WARN once
  at least 30 plays show 10% or more lost. From 300 it leads with the share.
- **One lost start per tab per show** (2026-10-11). A failure row carries the
  page's own random `tab_ref` (`FAILURE_TAB_ID`, never the presence session).
  An unrescued failure is a new lost start only when the same tab's previous
  unrescued failure on that show is more than `LOST_START_GAP_MINUTES` (10)
  earlier; the rest are **repeats** (Try Again pressed again), shown beside the
  line, never added to it. Rows without a tab fall back to UA class and build.
  One phone pressing Try Again 33 times read as 33 losses before.
- **A tab updates itself at a natural break** (`src/services/build/stale-tab.ts`,
  installed by `(desktop)/layout.tsx`). It asks `/api/build` 30 s after load,
  every 5 min, and on coming back on screen, focus and `online`. A newer build
  is *pending* until `naturalBreak()` says now:
  - **never mid-audio, never while a text field has something typed in it;**
  - with sound on, only the station's gap between shows, on screen, where the
    new page may start sound without a tap (`canResumeAfterReload`: a Chromium
    engine and a tab that has had a tap). Safari and iOS wait for a pause;
  - with nothing playing: when hidden, or after 2 min without input.
- **It keeps the listener's place.** A show and its position come back as after
  any reload (the position is saved on `pagehide`). For the station it writes
  `hd-update-resume` (sessionStorage) and the new page calls
  `resumeStationAfterReload()`, which waits for the program and the clock and
  puts it back on the air with no tap. A refusal is a `handover-rejected` row
  whose detail starts `reload`. The counted-airings set is kept in
  sessionStorage (`hd-live-counted`), so a reload never counts an airing twice.
- **Never a loop:** `hd-update-reloaded-for` holds the build a reload was for,
  and a page that comes back still not on it stays put.
- **A new bridge source starts at 0** (`fromTheTop` in `engine.ts`). A
  `currentTime` written before metadata (priming the remembered show) is the
  element's default start position, and Chromium keeps it across a change of
  `src`: after a reload the station ID started at 94 s, ended at once, and the
  next show never started. `e2e/stale-tab.spec.ts` found it.
- **Tests:** `src/services/build/__tests__/stale-tab.test.ts`, the reload block
  in `src/audio/__tests__/live-station.test.ts`, `live-session-reload.test.ts`,
  and `e2e/stale-tab.spec.ts` (a tab on build A, B deployed in the page, the
  reload after the slot boundary, B playing with no tap). Mutations: the
  `stale-tab-*`, `live-*reload*`, `build-*` ids.

## Visitors and location (2026-10-19, read before touching `src/services/stats/db/visitors.ts` or `src/lib/geo/`)

Full account: `docs/visitors.md`.

- **`visitors` is one row per browser**, keyed by a random id the browser keeps
  (`hd-visitor`). Location is a country and a region from the self-hosted geo
  database (`/var/lib/highdesert-geoip/city.mmdb`, DB-IP City Lite, refreshed by
  `highdesert-geoip.timer`); **the address is never stored**, here or anywhere.
  Never add a third-party geo or analytics service.
- **Backfill is placeholders, claimed.** Funnel arrivals since 2026-09-27 are
  `origin = 'funnel'` rows; a browser naming its arrival deletes one in the
  same transaction; the sample timer reconciles them (`planPlaceholders`).
  Anything that writes `visitors` must keep "a browser is counted once".
- **A city only when the database vouches for it** (accuracy radius ≤ 50 km);
  DB-IP Lite has none, so the feed is region-level. Pages showing places credit
  DB-IP (the APIs carry `attribution`).

## Holiday seasons (2026-10-29, read before touching `src/lib/season/` or `src/styles/seasons.css`)

Full account: `docs/seasons.md`.

- **`<html data-season>`** is set in the head before first paint by
  `SEASON_SCRIPT`, from the visitor's own date: `halloween` 15 Oct to 1 Nov,
  `thanksgiving` the 10 days before Thanksgiving (fourth Thursday of
  November) and the day, `winter` the day after Thanksgiving to 6 January.
  `?season=halloween|thanksgiving|winter|off` previews one on any page. The
  script inlines `seasonOn`'s source, so `seasonOn` must stay
  self-contained (no imports, no outside calls).
- **Looks:** Win98's title bars (`--hd-w98-title-start`/`-end`) and desktop
  (`--hd-w98-teal`) take the season's colours; Night's `--hd-amber` becomes
  the season's accent. Everything lives in `src/styles/seasons.css`.
- **SeasonSky** (`src/components/desktop/SeasonSky.tsx`): bats, leaves or
  snow on a canvas in the shell, behind the glass in Night and over the
  windows in Win98 (a third as many, z-index 45, never a tap). Nothing with
  reduced motion or while hidden. The status bar greets the season
  (Halloween keeps its Ghost to Ghost badge).
- **The station** airs a holiday show (`showSeason`: Ghost to Ghost,
  Christmas, New Year's) as a fan favorite only in its season; it always
  airs on its own date.

## The weekly digest

`highdesert-digest.timer` (17:40 UTC daily; writes Mondays from 2026-10-05)
runs `scripts/digest.mjs`: `docs/digest/YYYY-MM-DD.md` on main from its own
checkout, copied to the Mac's `~/Downloads/high-desert-digest/`. What needs
action first; then the release line and verdict, the funnel, locked phones,
the week, health. A FAIL, or the release at 3%+ on 300+ plays, adds the rows,
the pattern and a proposed fix. `docs/digest/README.md` has the rules;
`highdesert-status`'s `digest` line says whether the week's is written and on
the Mac.

## Live chat — the phone lines (read before touching `services/live/` or `src/components/live/`)

The chat beside Live Broadcast. Its own unit, **`highdesert-live`**, runs as
user `hdlive` from `/opt/highdesert-live` on 127.0.0.1:3005. It carries SSE
down and JSON POST up, and keeps its state in eight `live_*` tables in the
`highdesert` database. It connects as its own role, `highdesert_live`. A web
deploy never drops a chat stream. The full account is in `docs/live-chat.md`.

- **The listener count is not the chat's.** `<LiveChat />` shows
  `useCommunityNow().live` from the one presence function, in the header and
  beside the call box. The service's `clients` is an operational number for
  `highdesert-status` only.
- **Calling from, and tune-in lines** (2026-09-27, `docs/live-chat.md`). A
  caller may set a place (`POST /live-api/place`), filtered and limited like a
  name, cleared any time, and shown after the name on each call as sent. It
  is suggested from the browser's time zone only. **Never add IP
  geolocation.** `tuneIn()` posts `/live-api/tuned`; the service batches
  tune-ins into at most one line a minute, one per caller an hour. A viewer
  can hide them.
- **Archive moments** (2026-10-11, `services/live/lib/archive.mjs`,
  `docs/live-chat.md`). A line from the show's history, only into a quiet
  room: someone connected, no call for 20 min, none posted for 60 min.
  Picked against the show on the air (that episode, its topic, today's
  date, then any). Its own event and its own card ("From the archive"),
  never a caller: no name, no line, no Report, **nothing stored or counted**.
  **Every moment cites a public source** (`source: {title, url, supports}`,
  the standard of `data/notable.md`; a test fails on one without). A moment
  that cannot be sourced is cut, never softened: 30 of the first 50 survived.
  All but the sign-on are descriptions, never presented as quotes;
  `form: "quote"` needs a sourced transcript.
- **Readable lines** (2026-10-13, `docs/phone-lines-2026-10-13/handoff.md`).
  Every surface draws the same rows from `chatRows()` (`src/lib/live/chat-rows.ts`):
  each call a block, head first (name bold, then ", calling from Place" and
  the line quieter, the time dimmer), the message below; a run of tune-ins
  folded into one small line ("3 new listeners tuned in"); an archive moment
  indented and framed with its link inside; your own calls tinted
  (`isOwnCall`: posted here, or under hello's `you.name`). Scrolled up, new
  calls wait behind **New calls below** (`useFollowLog`); at the bottom the
  list follows, and your own call takes you down. Win98's Notepad keeps its
  type and draws the same blocks (`notepad-log.ts`, `look-win98.css`).
  **Generated names carry no place** ("Sleepless Night Owl",
  `services/live/lib/names.mjs`): the caller's own "Calling from" is the
  place. Stored names ("Night Owl in Pahrump") are never renamed.
  Tests: `chat-rows.test.ts`, the readable-lines block in `live-chat.test.tsx`,
  `notepad-phone-lines.test.tsx`, `e2e/phone-lines-busy.spec.ts`; mutations `lines-*`.
  **Polish** (2026-10-13, `docs/lines-polish-2026-10-13/handoff.md`): Change name
  and Change place are small inline text buttons on one line (`TextAction`, 44 px
  `::after`); the sheet opens focused on itself (`useFocusTrap` `focusContainer`,
  `.hd-focus-host`), so a tap shows no ring and Tab still does; Notepad's time
  stays on the first line (`hd-w98-notepad-who`/`-when`).
- **One browser, one caller** (2026-09-26). A caller is a random id in the
  signed `hd_live_caller` cookie (HttpOnly, Secure, Path=/live-api, 400 days,
  `services/live/lib/caller.mjs`); `client_ref` is an HMAC of it. Names,
  lines, the rename limit, reports, mutes and bans key on it. It used to be
  an HMAC of the address, which made a household, or a carrier's NAT, one
  caller. **Never key a per-person rule on the address again.**
- **The address is a secondary, generous limit.** `addr_ref` is the HMAC of
  the app's own `clientKey()` (shared through the symlink
  `services/live/lib/shared/client-key.ts → src/lib/utils/client-key.ts`,
  copied with `-L` on deploy): 300 new callers and 30 first calls an hour, 60
  messages a minute. A ban also holds the address for 24 h: one new caller an
  hour may start talking, so clearing cookies is not a free reset, and callers
  already there are untouched. Reports count distinct addresses. **No address
  is stored**: every ref column has a CHECK that it is 64 hex characters.
  `X-Forwarded-For` is trusted only from loopback.
- **Moderation is server-side and free.** `obscenity` plus
  `data/chat-blocklist.txt`, which the owner extends: `mask:`, `allow:`,
  `b64:`, `*wildcards*`.
  - Mild profanity is masked; slurs, threats, hate and sexual terms are
    blocked.
  - Links, emails and phone numbers are refused.
  - Limits: 280 characters, 1 message per 3 s, duplicate and flood checks,
    and auto slow mode at 20 messages in 30 s.
  - 3 reports from distinct clients hide a message and mute the sender for
    10 min.
  - Names go through the same filter, are unique among active callers, and
    change at most once per 10 min.
  - **Every catalogue title must pass unchanged** (`filter.test.mjs`). Fix a
    false positive with `allow:`, never by weakening a transformer.
  - **Test fixtures hold no slurs in plain text.** They are base64, and the
    variants are derived at test time.
- **Ship a blocklist change without a restart:** commit it, then run
  `bash scripts/deploy-live.sh --blocklist`, which parses the file, installs
  it and sends SIGHUP.
- **Admin is a server-checked credential.** `LIVE_ADMIN_TOKEN` lives in
  `/root/.high-desert-live.env` (chmod 600). `bash scripts/live-setup.sh --link`
  mints a single-use sign-in link (24 h, stored hashed) and copies it to the
  Mac's `~/Downloads`. The link sets an HttpOnly, Secure, SameSite=Strict
  HMAC cookie. The UI only reflects `admin: true`; the server checks every
  action.
- **The 10% rule.** `highdesert-status`'s `live` line FAILs above 10% of one
  core, judged on hd-cpu-sample's 15-minute cgroup mean. The service's own
  average from `/live-api/health` is the fallback while the ring is young.
  `CPUQuota=25%` is only a safety net. A load test of 200 callers measured
  3.0%, with 0 deliveries lost (`services/live/scripts/load.mjs`).
- **The load-test header `x-live-test-client`** works only with
  `LIVE_LOAD_TEST=1` and only from loopback. The unit never sets it, and
  `deploy-live.sh` refuses an env file that does.
- **Deploy** (never `npm install` here):
  1. `bash scripts/live-setup.sh` (once);
  2. `bash scripts/deploy-live.sh` — stages, runs `npm ci`, `pg_dump`, applies
     the schema, installs the unit, swaps, installs the nginx locations
     (`nginx -t` first), then verifies health, an SSE hello through nginx and
     a POST round trip, rolling back on failure;
  3. `bash scripts/live-setup.sh --link`.

  `--verify-only` and `--rollback` exist. `scripts/deploy.sh` does not touch
  the chat.

## Dexie: clearing a field

**Correction — the claim that used to be here was wrong.** It said `Table.update()`
ignores keys whose value is `undefined`, making `update(id, { rating: undefined })` a
silent no-op. **Dexie 4.3.0 deletes the key**, exactly as `.modify()` does. Verified
directly against the installed library; `dexie` has been pinned `^4.3.0` since the first
commit and has never been upgraded, so the premise was never true for this project.

The belief survived because the regression test asserted it against a *hand-written model
of Dexie* rather than Dexie — it could not fail. The test now uses `fake-indexeddb` and
drives `toggleFavorite`/`rateEpisode`/`toggleFlag` end to end against the real database:
`src/services/episodes/__tests__/clear-field.test.ts`. The full account — what `b88378d`
claimed, what the library source actually does, and why the mirror test could not
disprove it — is in `docs/dexie-update-semantics.md`.

`applyEpisodeFields()` in `src/services/episodes/management.ts` stays, and is still what
to use — it is explicit about intent and does not depend on a third-party library's
treatment of `undefined` staying put. But it is **not load-bearing** for this behaviour.
Whatever made ratings and favourites appear uncleared, it was not `update()`; the other
half of that fix, below, is the likelier culprit and is independently confirmed.

Related: the library's detail panel renders `selectedEpisodeLive`, re-read from the
live query, not the `useState` snapshot taken when the row was clicked. Writes made from
inside the panel are otherwise invisible until it is closed and reopened.

## Database (Dexie v9)

**Primary entity:** `Episode` — identity (id, fileHash), metadata (title, airDate, guestName, showType), audio (duration, bitrate), playCount, archive source, AI fields (aiSummary, aiTags[], aiCategory, aiSeries, aiNotable, aiStatus), user fields (favoritedAt, rating).

**Other tables:** `Progress` (below), `Playlist`, `HistoryEntry`, `Bookmark`, `ScanSession`, `UserPrefs` (key/value).

### Playback position lives in `progress` (v9, HD-016)

`playbackPosition` and `lastPlayedAt` are **not** on the episode row any more. They
live in `db.progress` (`Progress {fileHash, playbackPosition?, lastPlayedAt?}`, schema
`"fileHash, lastPlayedAt"`). Every position save used to be a write to `episodes`,
which re-ran every live query over the whole table — the library list, facets, smart
playlists, stats — every 30 s of playback and on every pause.
`src/hooks/library/__tests__/position-save-quiet.test.tsx` drives the real saves against
the library's real query (`useLibraryEpisodes`) and holds its render count still, with a
control proving an episodes write does wake it.

- **Keyed by `fileHash`**, not the numeric id: it is what Export/Import travel by, the
  dedup/heal/legacy-key merges retire ids but never hashes, a doubled library's twins
  share one entry, and the unload flush can `put` without reading the episode first.
- **One writer: `writeProgress()`** (`src/services/episodes/progress.ts`) — patches
  `useProgressStore` synchronously, then upserts the table. The one exception is the
  unload flush, a raw IndexedDB `put` into `progress` (Dexie cannot run in unload) that
  patches the store itself.
- **Reads are synchronous, from `useProgressStore`** (`positionOf`, `useProgress(hash)`,
  `useProgressIndex()`, `useStartedHashes()`). `playEpisode()` must not await before
  `play()`, so the start position cannot come from IndexedDB. `startProgressSync()` —
  started once in `(desktop)/layout.tsx` — keeps the store equal to the table, other tabs
  included; the restore path awaits `progressReady()`. An entry keeps its object identity
  until its own numbers change, so a save re-renders the one playing row, not 1,312.
- **"Recently played" / "Continue listening"** read `recentlyPlayedEpisodes()`, which walks
  the `progress.lastPlayedAt` index and joins episodes by `fileHash`.
- **Listened time was never on the episode row** — it is `history.duration`
  (`src/services/episodes/listen-time.ts`) and stays there.
- **The v9 upgrade COPIES and leaves the old fields in place**
  (`src/db/progress-migration.ts`). Stripping them would be a second write to every row
  of the one table with no server backup, inside an upgrade, for no gain. No code reads
  them: the `Episode` type no longer has them (`StoredEpisode` names them for the merge
  code that runs *before* v9), and the episodes' `lastPlayedAt` index is dropped so a
  stray `where("lastPlayedAt")` throws instead of answering from frozen data. Two rows
  sharing a hash become one entry by `mergeProgress` (later play wins, with its position).
  `src/db/__tests__/progress-migration.test.ts` runs v8 → v9 on the real seeded catalog
  and asserts every value arrives and every row of every table is otherwise unchanged.
- **Every path that deletes or merges episodes handles `progress` in the same
  transaction:** `deleteEpisode` (drops the entry unless a twin still has the hash),
  `clearLibrary`, `deduplicateEpisodes` (moves the later-played copy's entry to the
  keeper's hash). A new one must too.

**Show types:** `"coast"` | `"dreamland"` | `"special"` | `"unknown"`

## Admin Mode

Gated by `useAdminStore` — SHA-256 password check. Enables Scanner tab, Search tab, Library menu
(import, export, deduplicate, clear). Persisted in `localStorage['hd-admin']`, hydrated **after**
mount (reading it during render caused a hydration mismatch). Force viewer mode via `?viewer`.

**This is UI gating, not a security boundary.** The hash is a client-side constant and anyone can
set the localStorage key. Never put anything behind it that must actually be protected — all
admin features are local-only and touch nothing server-side.

## Looks: Win98 and Night (2026-10-12, read before touching `src/lib/look/`, `src/proxy.ts`, `src/styles/look-*.css` or `src/components/looks/`)

Two public looks, chosen per device: **Win98** (the default, and what crawlers
see) and **Night** (the dark theme). Full account: `docs/looks.md`.

- **The choice is a plain cookie**, `hd_look=win98|night` (`lookCookie()`).
  `next.config.ts` rewrites each page into `src/app/[look]/` by it, so the
  server renders the chosen look; `<html data-look>` and `useLook()` say which.
- **Switching** is `chooseLook()` (`src/lib/look/choice.ts`): cookie, then
  reload. Win98: Start > Settings > Display (Display Properties). Night: More >
  Display on a phone. Both: View > Display... on a desktop.
- **A first visit in Win98 is offered Night once** (`NightOffer`): written as
  offered before it shows, after the boot screen, never over a phone's Listen
  tap on /live, never on show pages or a crawler's first paint.
- **Arrivals, funnel steps and plays record the look** (`arrival_daily.look`,
  `funnel_daily.look`/`again` and the `return` step, `play_events.look`), so an
  audit can compare looks on tune-ins and returns (`docs/funnel.md`, "By look").
- Look CSS only under `html[data-look="…"]`; colours are `--hd-*`/`--hd-w98-*`.
  Win98 swaps: `Taskbar`/Start menu for the tabs, `WinampPlayer` for the player,
  `NotepadPhoneLines` for the chat, dense Details rows for the phone library,
  and the hidden Mel's Hole (type `hole`, or Start, Run…, `melshole`). Both
  looks: an empty player shows the station with one tap to tune in.
- **Radio is a Library mode** (`/library?view=dial`, `/radio` redirects there).
- **No gesture is ever a command** (2026-10-12, `e2e/scroll-gestures.spec.ts`).
  Easter eggs open from deliberate acts only: Start, Run…, `melshole`; "hole"
  typed on a keyboard (Win98's Taskbar, Night's `useTypedWord`); a search word;
  a key chord. Mel's Hole used to open on the twelfth scroll event at the bottom
  of the Library, which one iPhone scroll (momentum and bounce) supplies.
  `eggs-deliberate.test.ts` lists every place an egg opens. A row's long press
  is cancelled by any scroll and by `touchcancel`; a row swipe, and the dial
  strip, lock to an axis once per touch. The spec scrolls every main screen
  on a phone in both looks and fails if anything opens; with `E2E_WEBKIT=1` it
  also runs in WebKit (the `iphone` project), whose iOS bounce is modelled in
  `e2e/touch.ts`.
- **The Library on a phone** (`e2e/library-phone.spec.ts`): Continue listening
  as one row (`dense`), then search and filters (List / Dial beside the show
  tabs), then the list, whose first shows are on the first screen (3 Win98
  rows, 2 Night cards, with everything showing). The swipe tip and Explore
  (On this date) sit under the list; the install offer is one slim line.

## Design System

- **Desktop:** Windows 98 dark theme — raised/inset bevels, title bars, menu bars, context menus, status bar
- **Mobile:** Glassmorphism — frosted blur surfaces over animated starfield, bottom tab navigation, swipe gestures
- **Responsive breakpoint:** 768px (`useIsMobile()` hook). **It answers desktop on the server and
  through hydration** (HD-037); a phone flips to mobile right after. It used to be the other
  way round, so every desktop visit mounted the mobile tree first
  (`src/hooks/__tests__/is-mobile-hydration.test.tsx`)
- **Player states:** ultra-mini (28px taskbar), mini (bar), expanded (full panel), mobile mini, mobile expanded (full-screen overlay)

## Security Headers

CSP built in `src/lib/csp.ts`, sent by `next.config.ts` — `connect-src` allows only
`archive.org` (and self). `frame-ancestors` permits `'self'` plus `sang3r.com`/`www.sang3r.com`
(deliberate embedding), so it is *not* fully denied. `'unsafe-inline'` stays (Next's inline
bootstrap); **`'unsafe-eval'` is development-only**. `object-src 'none'`, `base-uri 'self'`,
`form-action 'self'`. `images.unoptimized` (nothing uses `next/image`, so `/_next/image` is
404) and `poweredByHeader: false`.

`npm run check:csp -- <url>` (`scripts/csp-check.mjs`) loads every route in headless Chromium
and fails on any CSP violation, page error or console error. CI runs it against the built app
with a real Postgres behind it. Run it against production after anything that could change
what a page loads.

## Deployment — self-hosted on the VPS

No third-party hosting. Same shape as `sanger-next`.

- **App:** `next start -p 3003` under systemd (`highdesert.service`), nginx vhost with a certbot cert
- **Stats:** Postgres database `highdesert` on the same host; `DATABASE_URL` comes from a
  chmod-600 `EnvironmentFile=` (`/root/.high-desert.env`), never inlined into the unit and
  never committed. **`deploy.sh` applies `scripts/schema.sql`** (idempotent)
  after the new build has passed and right before the switch, in one
  transaction, and only when its digest differs from `.deploy/schema-applied`;
  a failed build or a failed schema leaves both the database and the live build
  as they were. By hand: `psql "$DATABASE_URL" -f scripts/schema.sql`
- **Backup:** `highdesert-backup.timer` (17:30 UTC) pg_dumps to `/root/backups/highdesert`
  (14 days) and rsyncs to the MacBook over Tailscale (skipped under 5 GB free).
  `highdesert-backup-status` → OK / FAILED / STALE (>36h). Restore procedure and the
  rehearsal: `docs/backup.md`. **Encrypted off-box copy** (2026-10-11,
  `scripts/backup-offsite.sh`): every kept dump, age-encrypted to
  `deploy/backup-age-recipient.txt`, force-pushed as one orphan commit to the private
  repo `jackson-jpeg/highdesert-backups` (14 days, no history), with a
  decrypt-compare-`pg_restore --list` restore test every run. The private key is
  `/root/.high-desert-backup-age.key`, never on GitHub
- **Traffic sampler:** `highdesert-sample.timer` POSTs `/api/stats/sample` every 2 minutes,
  authenticated with `STATS_SAMPLE_SECRET` from the same env file. This is the only writer to
  `listener_samples`, and the only reason any *history* exists — `active_sessions` is a live
  set that is pruned as it is counted, and `episode_plays` has no timestamps. A timer rather
  than sampling on read, so quiet periods record real zeroes instead of leaving gaps
- **Presence has one truth.** `getPresence()` is the only computation of online and
  listening — distinct `client_ref`, not sessions (two tabs are one person) — and
  `/api/stats/now` the only endpoint any surface reads, through the shared, ref-counted
  client feed `src/services/stats/now-feed.ts` (`useCommunityNow`). The Stats badge, the
  status bar, the mobile sheet, On Air and Signal Traffic's "Right now" all render that one
  snapshot, each tagged with `presenceAttrs()` (`data-presence`, `data-online`,
  `data-listening`, `data-presence-poll`); `presence-surfaces.test.tsx` holds them equal and
  `highdesert-status` checks the live site. Never give a surface its own fetch or its own
  arithmetic — the badge's `online − 1` and a second poll on a second clock once put 7, 8
  and 10 "online" on one screen. `listener_samples.online` counts clients from 2026-09-24
- **On air is a renewed mark, not a timestamp of when you pressed play.** `onAir` filters
  `active_sessions` on `listening_at >= now() - 5 min`. `recordPlay` sets that mark once;
  if nothing renews it, every listener drops off the air five minutes in and stays off for
  the remaining two hours and fifty-five minutes of a Coast to Coast broadcast — the list
  silently degrades into "who started something recently". The 60s heartbeat carries the
  episode while playing and renews it. Anything that changes the heartbeat must keep that
  property, and `ACTIVE_WINDOW_MS` must stay comfortably above the heartbeat interval
- **Recent plays:** `recent_plays` is a rolling 24h log written by `recordPlay`, pruned in the
  same statement that inserts. It exists because neither `episode_plays` (a counter) nor
  `listener_samples` (a cumulative total) can answer *what* was just put on — the one thing
  that makes the site feel inhabited. It deliberately holds no session id
- **The forever log:** `play_events` and `traffic_daily` are the only tables here that are
  never pruned, and everything else is expressly temporary — `recent_plays` at 24h,
  `listener_samples` at 90 days, `weekly_plays` at 3 weeks, `active_sessions` as a live set.
  `recordPlay` appends to `play_events` in the same atomic statement as everything else, and
  the sample timer rolls the day up into `traffic_daily` so multi-year history survives the
  sample prune. Rollup recomputes a 3-day trailing window (so a play either side of midnight
  is not frozen into the wrong day) and never revises a day's plays or sessions *downward*
- **Session refs expire, events do not.** `play_events.session_ref` holds the anonymous
  per-page-load id for 90 days, then `anonymizeOldSessions()` NULLs it and the permanent row
  becomes exactly what `recent_plays` always was: an episode and a time, attached to nobody.
  The id was never linkable to a person or a returning visitor (`src/lib/utils/session-id.ts`
  regenerates it every page load), so this is about not being able to group one sitting's
  listening years later. **Keep the public `/api/stats/*` routes aggregate-only** — the
  session ref exists for `/api/stats/export` and nothing else
- **Rate limiting:** `src/lib/utils/rate-limit.ts` is an in-memory Map. That was useless on
  serverless but is **correct here** — one long-lived process. It depends on nginx setting
  `X-Forwarded-For` to `$remote_addr` (overwrite, not append) so clients can't spoof it.
  **Key on `getClientKey()`, never the raw address**: it buckets IPv6 on the /64 (a home
  connection can mint 2^64 addresses) and folds IPv4-mapped v6 into the v4 client
  (`src/lib/utils/client-key.ts`, HD-007). The Map is capped at `MAX_KEYS`, evicts in LRU
  batches that skip entries currently blocking someone, and is swept by an unref'd interval —
  never inside a request. nginx adds a coarse outer `limit_req` on the POST stats routes;
  the vhost is versioned at `deploy/nginx/highdesert.conf` and `highdesert-status` WARNs on drift
- **Presence cap:** one client holds at most `SESSIONS_PER_CLIENT` (10) sessions in the
  online count. Session ids are minted in the browser, so without it "online" and "on air"
  were whatever a script posted. Over the cap a heartbeat is accepted (`{ok: true}`) and not
  counted; `active_sessions.client_ref` is an HMAC under a per-process random salt, never an
  address, and cannot be joined to `rating_votes`
- **Rating voters are HMACs:** `rating_votes.voter` is `voterId()` — HMAC-SHA256 of the client
  key under `RATING_VOTER_SECRET` (in `/root/.high-desert.env`). Without the secret
  `/api/stats/rate` returns 503 rather than store anything weaker, and the store refuses any
  voter that is not 64 hex. `scripts/migrate-hash-voters.mjs` converted the old plaintext rows
  (HD-008); see `deploy/README.md`
- **`playback_failures.detail` is attacker-controlled text.** It is stored as posted (bounded,
  for diagnosis by psql) but `/api/stats/failures` serves only browser-diagnostic shapes —
  `code=N`, `code=N DEMUXER_ERROR_…` (the tail dropped), `duration=…` — via `publicDetails()`
  in `src/services/stats/failure-detail.ts` (HD-038). Anything else is one placeholder
- **Build id:** `next.config.ts` derives `NEXT_PUBLIC_BUILD_ID` from the git SHA and the service
  worker registers as `/sw.js?v=<id>`, so each deploy installs a fresh worker and purges the
  previous build's cache. Do not hardcode the cache name again
- **No env vars are required** for the app to boot; without `DATABASE_URL` the `/api/stats/*`
  routes return 503 and the UI degrades to empty stats
- **sang3r.com reads this database, it does not copy it.** `/high-desert` on sang3r.com and
  the `sanger_highdesert` MCP tool both proxy `/api/stats/export` over loopback
  (`HIGHDESERT_API` / `HIGHDESERT_TOKEN` in `/root/Sanger/.env.local`, where the token is this
  app's `STATS_EXPORT_SECRET`). Mirroring the log into Supabase was the alternative and would
  have meant a sync cursor to babysit and a second definition of "a play". One writer, one
  source of truth — if the shape of the export changes, only the proxy and the page follow

## Scripts (`/scripts/`)

- `categorize-library.py` — offline batch AI categorization; output is committed into `public/seed/library.json`. This is the ONLY place AI runs
- `clean-library.py` — Python script for library cleanup
- `import-community-sources.mjs` — add-only import of the shows in `data/community-sources.json`
  (a listener's torrents, used only as a list of names; every show streams from an existing
  archive.org copy). **Never download a torrent's content or join its swarm, and never host or
  link its magnet** — a test fails on the three infohashes anywhere in the app. See
  `docs/community-sources.md`
- `measure-duration.mjs` — an episode's runtime by walking every frame (see "Is there actually
  a broadcast in the file?")
- `schema.sql` — the community stats schema; idempotent, re-run on every deploy that touches it
- `backfill-traffic-daily.sql` — one-time (and re-runnable) fill of `traffic_daily` from
  whatever `listener_samples` still holds. Only matters when the rollup is deployed after
  sampling has been running; plays are derived from cumulative deltas, so those days are
  approximate at the midnight boundary and carry `sessions: 0`

## Deploying to the VPS — do not break the live service

`/root/High-Desert` **is** the production directory. `next start` reads chunks
from `.next` lazily, at request time, so the running server holds a manifest
pointing at files on disk.

**Never `rm -rf .next` or `node_modules` here while the service is running.**
Doing so leaves the process serving pages that reference JS chunks that no
longer exist: every route still returns **200**, but browsers cannot load the
app — buttons do nothing and audio never starts. This has happened once, during
a "clean install" verification, and took real users down. HTTP status checks
will not catch it.

Deploy — **always with the script** (full account: `docs/deploy.md`):

```bash
cd /root/High-Desert
git pull                               # or checkout the intended ref
bash scripts/deploy.sh                 # refuses a dirty tree
bash scripts/deploy.sh --verify-only   # client-side check of the running server
bash scripts/deploy.sh --rollback      # swap live <-> previous build, restart, verify
highdesert-status                      # deploy drift, service, backup, sampler, failures, audit
```

- **It builds into `.next-staging`** (`HD_DIST_DIR`, read by `next.config.ts`), never
  into the live `.next`. `next build` empties its distDir first, so building in place
  meant a failed build left the running server serving deleted chunks. A failed build
  now exits non-zero with the live site untouched and nothing restarted.
- **A lockfile change installs and builds in a staging copy** of the tree and swaps
  `node_modules` in with the build. The live `node_modules` is never deleted under the
  running process.
- **Verification is client-side and fails closed**: the server must answer, and `/`,
  `/library`, `/radio`, `/stats` must each be 200, reference ≥1 chunk, and every chunk
  must be 200. Any failure **rolls back to `.next.prev` automatically**.
- **Then a returning visitor, in Chromium and WebKit** (2026-10-14): a
  profile primed by the old build before the swap is revisited on the new one;
  a Library or Stats that does not load rolls back too (see "Nothing spins
  forever"). `HD_RETURNING_CMD=` (empty) skips it.
- The commit is checked into the service-worker registration chunk *before* the swap.
- **The schema goes in after the build and before the swap** (2026-10-12), only
  when `scripts/schema.sql` changed since the last deploy that applied it
  (`.deploy/schema-applied`), with `--single-transaction`. It used to be applied
  by hand before the build, so a build that then failed left the live code on
  a newer schema. `deploy.test.ts` ("the schema") proves a failed build leaves
  it untouched.
- **Route types from earlier builds are cleared before every build**
  (`.next/types`, `.next/dev/types`, `.next-dev/types`, `.next.prev/types`):
  `tsconfig.json` includes them, and a route since deleted failed the next
  build's type check.
- **A docs-only commit is not drift.** When everything between the deployed
  build and `HEAD` is under `docs/` or a top-level `*.md` (a handoff),
  `highdesert-status`'s `deploy` line reads OK and nothing needs deploying.
- **Commit guard.** `.commit-guard` opts this repo into
  `/root/vps-tools/bin/commit-guard` (the global pre-commit): no staged file
  over 20 MB, nothing inside `.next*`, `node_modules*`, `test-results`,
  `playwright-report`, `coverage` and the like. `src/lib/__tests__/repo-hygiene.test.ts`
  holds the same rule for what is already tracked, where hooks do not run.

**Never run `npm install` / `npm ci` in `/root/High-Desert`.** It rewrites the live
`node_modules` under the running server — this happened during the 2026-09-21 upgrade
(`docs/deploy.md`, "Incident"). Change dependencies in a separate checkout
(`git worktree add ../hd-deps main`), commit, pull here, and let `deploy.sh` install
them in its staging copy. There is no safe "by hand" equivalent of the deploy any more:
the old `npm run build && systemctl restart` builds in place.

**Commit before you build.** `NEXT_PUBLIC_BUILD_ID` names the service worker
cache, and `activate` only purges caches whose name *differs* from the current
one — so a build id that repeats the previous deploy's leaves that deploy's
shell cached and served to offline visitors. A build once ran 85 seconds before
the commit it was meant to ship and went out stamped with its predecessor.
`next.config.ts` hashes the working tree into the id when the tree is dirty, but a
dirty deploy still ships something that is not in git.

For destructive verification (clean installs, dependency bisects), copy the repo
elsewhere and test there.

**The service is sandboxed** (`deploy/highdesert.service`, HD-026): `next start -H
127.0.0.1`, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only`,
`PrivateTmp`, and only `.next` writable. Anything new that writes at runtime outside
`.next` will fail with `EROFS` — add a `ReadWritePaths=` for it, deliberately.

## Data safety — read before touching `src/db/`

All user data (favorites, ratings, playback positions, history, bookmarks) lives **only** in the
visitor's IndexedDB. There is no server backup. A bad write here is unrecoverable.

- **Identity key is `fileHash`** (`archive:{identifier}:{fileName}`) — unique across the catalog,
  indexed, and built identically by the seeder and both import paths — always through
  `archiveFileHash()` in `src/db/identity.ts`. `archiveIdentifier` is the
  *collection* id and is the SAME for every episode; never use it alone as an identity. The catalog
  scraper once wrote `archive:{identifier}` with no file name; the **v8** Dexie upgrade
  (`src/db/legacy-keys.ts`) rewrites those rows, merging any that collide with a canonical row
  without dropping user data.
- **Seed, heal and reconcile hold the cross-tab `"hd-seed"` Web Lock** (`src/db/seed-lock.ts`) and
  re-check inside their rw transaction. Two first-visit tabs used to seed 1,312 rows each (HD-009).
  The lock is not re-entrant — never call one locked function from inside another.
- **`reconcileLibrary()` is `bulkAdd`-only.** It restores catalog rows missing locally and by
  construction cannot touch an existing row. Keep it that way — never `bulkPut`, never `update`.
- **No unattended destructive operations against `db.episodes`, ever.** Deduplication is
  user-initiated and confirmed. An automatic dedup once deleted 1,312 of 1,313 episodes for
  users who had grown their library past a threshold. **Two narrowly scoped exceptions, each
  documented at the top of its file and each asserting on what survives:** `healDoubledLibrary()`
  (`src/db/heal.ts`) acts only when every catalog `fileHash` present appears *exactly twice* — the
  double-seed signature — and refuses the whole library on anything else (a triple, a lone
  user-made duplicate); and the v8 legacy-key upgrade merges only rows with the identical
  canonical key. Both fold the retired row's favourite/rating/plays/flag into the keeper
  (`absorbUserData`) and repoint history, bookmarks, playlists and the saved queue
  (`repointEpisodeRefs`, `src/db/merge.ts`) in one transaction before anything is removed. Do not
  add a third.
- **The v9 upgrade (`src/db/progress-migration.ts`) writes only to the new `progress`
  table.** It copies `playbackPosition`/`lastPlayedAt` off every episode row and leaves the
  rows exactly as they were — no field stripped, no row rewritten — which the migration test
  asserts row by row on the real catalog. Keep upgrades over `episodes` additive like this; a
  cleanup of the frozen fields, if ever wanted, is its own reviewed version.
- **`refreshCatalogFlags()` (`src/db/catalog-flags.ts`) is an unattended write, not a
  destructive one.** It sets `aiNotable: true` on the rows listed in `data/notable.json`,
  once per `NOTABLE_VERSION`, under the seed lock — never unsets it, never touches another
  field, never adds or removes a row. It exists because `reconcileLibrary()` is bulkAdd-only,
  so a catalog flag added after a visitor's seed never reaches them otherwise.
  `src/db/__tests__/notable.test.ts` compares every field of every row before and after.
  Adding to the list: `data/notable.md`, "Rules for adding one".
- **Delete and Clear Library are each one rw transaction** over every dependent table
  (`deleteEpisode`, `clearLibrary` in `src/services/episodes/management.ts`). A failure part-way
  leaves nothing half-deleted.
- **`deduplicateEpisodes()` has safety rails** (`MAX_GROUP_SIZE` 20, `MAX_DELETE_RATIO` 25%) and
  aborts rather than throwing. They are not optional — they would have prevented that incident
  independently of the key bug.
- Regression tests live in `src/db/__tests__/`; `dedupKey` must yield one distinct key per row of
  the real seed catalog (**1,413**: the 2026-09-28 community import made it 1,413,
  `docs/community-sources.md`; one removal on 2026-10-11 was undone the same day when the
  Egyptian Cave show was repaired instead, `docs/broken-episodes.md`).
  The count is asserted against the catalog rather than hardcoded, so pulling an episode does not
  need the test edited; changing it to a literal would make the next removal look like a bug.
- **`deleteEpisode()` is covered end to end** against `fake-indexeddb` in
  `src/services/episodes/__tests__/delete-episode.test.ts` — the cascade into
  history/bookmarks/playlists, the tombstone, and `reconcileLibrary()` honouring it. Note the
  **control test**: it deletes the same row *without* a tombstone and asserts reconcile **does**
  restore it. Without that, "reconcile restored nothing" is not evidence — a reconcile that never
  ran would pass identically, which is the exact trap `docs/disconnected-checks.md` is about.
  The cascade assertions are written on what **survives**, not on what is gone; the incident here
  was blast radius, and a too-wide cascade is invisible to a test that only checks the target row.
  `management.ts` carries four mutations in `scripts/mutate-check.mjs` rather than the usual one —
  it writes to five tables and there is no server backup, so one anchor would leave two of the
  three properties unobserved.

## Keeping the data: persist(), the audio cache, Export / Import (HD-010)

- **`navigator.storage.persist()` is asked once per profile, after the first real write**
  (`src/db/persist.ts`). Dexie hooks installed from `src/db/index.ts` watch episodes
  (`favoritedAt`/`rating`/`flaggedAt` changes), every `progress` write (a saved
  position), bookmark creation and playlist writes; the seed is not counted. The request is recorded as the userPref
  `storage-persist-requested` and never repeated. A new write path needs nothing — the hook
  sees it — but a new *kind* of listener data belongs in `USER_EPISODE_FIELDS` or a hook.
- **The OPFS cache shares a quota with the library** (`src/audio/cache.ts`), and running out
  evicts the whole origin. Writes are checked against `storage.estimate()`, refused past
  `CACHE_QUOTA_FRACTION` (0.8), serialized, and removed if they fail midway.
  `cacheAudioBlob` resolves a `CacheWriteResult` and never rejects. No `estimate()` → refused.
- **File > Export / Import My Data** (and the mobile sheet) — `src/services/user-data/portable.ts`.
  Versioned (`format: "high-desert-user-data"`, `version: 1`), keyed by `fileHash`, never the
  numeric id. Import validates the whole file first, previews counts in a dialog, and merges
  **add-only** in one rw transaction: local values win conflicts, positions go to the later
  listen, same-name playlists are extended. Position and last-played are read from and
  written to `db.progress`; the file format is unchanged. A new personal field must be added to both
  export and `plan()`, with the round-trip test in `__tests__/portable.test.ts`.
- **The admin "Export Library Seed..." writes a bare array** (`src/db/catalog-export.ts`),
  the shape `public/seed/library.json` and `src/services/stats/catalog.ts` read, from an
  allowlist of catalog fields — no favourites, ratings, flags, positions or local files.

## Pulling an episode from the catalog

Removing a row from `public/seed/library.json` is a four-step change, and skipping any of them
breaks a test or a route:

1. Remove the object from `public/seed/library.json`.
2. `node scripts/gen-community-keys.mjs` — otherwise the allowlist keeps a key with no episode
   behind it and `src/services/stats/__tests__/catalog.test.ts` fails. (It did, which is the
   point of that test.)
3. Record it in `docs/broken-episodes.md`, with the full original JSON object so it can be
   restored without reconstruction.
4. Add its `fileHash` to `REMOVED_FROM_CATALOG` (`src/lib/library/removed-episodes.ts`).
   `removed-episodes.test.ts` holds that list equal to the doc's JSON records and fails if
   one is back in the catalog.

Leave its entry in `data/show-slugs.json`: the show page goes away on its own (404), and the
slug must never be minted again for another show (`docs/show-pages.md`).

Existing visitors keep the row: `reconcileLibrary()` is `bulkAdd`-only and never deletes. That is
deliberate, and it is why the runtime guard below matters — a removal only stops an episode
reaching *new* visitors. **Nothing removes it for them automatically, and nothing may.** The row
is *marked* instead: **Unavailable** in the list and the detail panel; a play stops in
`playEpisode()` before any source is assigned (so no archive.org request, and whatever is playing
carries on) and raises `UnavailableEpisodeDialog`; and the detail panel and row menu offer
**Remove from my library** to every visitor, which opens the library's ordinary delete
confirmation and then `deleteEpisode()` — one transaction, tombstoned. Marked by exact `fileHash`
from the explicit list, never by "absent from the catalog", so a local file or the visitor's own
import is never marked. Tests: `unavailable-episode.test.tsx`, `unavailable-play.test.ts`.

## Is there actually a broadcast in the file?

One catalogued episode contained no audio at all: 77,380 bytes of ID3v2 tag wrapping a JPEG cover,
zero MPEG frames. Archive.org serves it with a clean `206`, the right `Content-Type` and a
plausible `Content-Length`, so **every HTTP-level check passes it** — including the full 1,313-file
sweep in `scripts/audit-episodes.mjs`. Pressing play produced nothing, which is exactly the "the
show didn't start" report that began this work.

- **`scripts/audit-durations.mjs`** is the catalog sweep. It reads the first 64KB of real audio and
  walks the MPEG frame headers. It must seek past the ID3 tag first — the tags on this collection
  carry cover art and run ~77KB, so a window taken from byte zero lands entirely inside the
  artwork and reports working three-hour shows as empty. The first draft did exactly that to 10 of
  the first 12 episodes.
- **`src/audio/duration-sanity.ts`** is the runtime guard, and it is deliberately timid. The
  "much shorter than catalogued" comparison waits for `ended`, when the number is a measurement.
  37 of the episodes are legitimately under ten minutes; flagging on length alone would break
  working shows to fix a broken one.
- **`ended` has sole authority to fail a show. `loadedmetadata` is advisory.** The absolute
  floor (under 5s) is still evaluated there, but it now only *records* — kind
  `empty-media-suspected`, with the reported duration in `detail` — and lets playback continue.
  `duration` at `loadedmetadata` is extrapolated from the first frame for a VBR rip with no Xing
  header, which is most of this catalog, and an extrapolation must not get stopping power over an
  episode that plays fine: a false stop costs a listener a show, while letting a genuinely empty
  file run costs a few seconds until `ended`. Note this code path had **never executed in
  production** before the `withGlobals` fix — the listener that calls it was never attached. The
  advisory rows exist to decide, from real traffic, whether the 5s floor is safe to promote.
- **A tag's `duration` is not evidence either.** Seven files carry a LAME "Info" tag written
  for a shorter recording than the file holds; archive.org's `length`, and the catalog's, came
  from it (1999-01-25 read 18.39 s for a 2.5 h show, and the live station cuts a slot at its
  duration). Their durations are now frame counts (`scripts/measure-duration.mjs`,
  `data/duration-corrections.json`, `docs/ios-stalls.md`). Before trusting a new episode's
  `length`, walk it.
- **A missing `duration` is not evidence of anything.** Archive.org's VBR derive reports
  `length: "0"` for five episodes here, two of which are full three-hour broadcasts.
- `empty-media` is the one `FailureKind` that is **never retried** — the same bytes come back, so a
  retry only adds twelve seconds to the wait. `PlaybackErrorDialog` drops its "Try Again" button
  and says the recording is empty rather than blaming the connection.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
