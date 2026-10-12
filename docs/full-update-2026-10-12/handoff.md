# High Desert: the full update. Handoff (2026-10-12)

Branch `session/2026-10-12-full`, one PR. Built from four work branches on a
shared foundation commit (`418d264`):

| Branch | What |
|---|---|
| foundation (`418d264`) | Looks go public: Win98 default, Night the option, `[look]` segment, one URL per page, preview code retired |
| `feat/looks` | Display setting in both looks, first-visit Night offer, look recorded on arrivals/tune-ins/plays, leftovers |
| `fix/meters` | iPhone visualizer and VU meters |
| `feat/growth` | Share URLs, share a moment, show/guest pages first-class, topic pages, Tonight |
| `feat/phone` | Live on a phone, Phone Lines tab slot, Continue Listening, install prompt |

**No GitHub Actions for this PR** (Jackson's call, 2026-10-12). Lint,
typecheck, the full suite, every mutation and the screenshot suite ran here on
the VPS through `heavy`. The PR's head commit and its merge commit carry
`[skip ci]`, so neither `ci.yml` nor `mutations.yml` ran on the PR or on
`main` for this merge. The nightly mutation run (09:30 UTC, scheduled) is
unaffected and is the first Actions run to see this code.

## What shipped, by area

**Looks.** Win98 is everyone's default; Night is the dark option. Switch in
Win98 at Start > Settings > Display..., in Night at More > Display (phone) or
View > Display... (desktop). A visitor with no choice on record gets one
"Prefer dark? Switch to Night" offer in Win98 (never on show/guest pages,
never over the boot screen, on a phone's /live only after tuning in); "No
thanks" or Escape ends it for good. The choice is the plain `hd_look` cookie,
read before rendering. Regulars from before today have no record either, so
they get the offer once too. `docs/looks.md`.

**Look in the stats.** `arrival_daily.look`, `funnel_daily.look` (+ `again`)
and `play_events.look`; a new funnel step `return` (first load on a later UTC
day); `/api/stats/funnel` `byLook` and `/api/stats/usage` `playsByLook`. That is
what the next audit compares Win98 and Night on (tune-in rate, returns).
`schema.sql` swaps the funnel/arrival primary keys for `NULLS NOT DISTINCT`
unique indexes: writes to those two tables fail between the restart and the
schema, so the deploy applied it right after `deploy.sh` restarted
(`docs/funnel.md`).

**Leftovers.** Win98 signal meter: navy blocks in a sunken white field (~16:1,
was 1.4:1). Win98 phone library rows: dense 52 px Details rows, not cards. An
empty player in both looks shows the show on the air with one Tune in tap
(not on /live itself).

**iPhone meters** (`src/audio/levels.ts`, `src/audio/level-tap/`). iOS never
had an analyser: routing the element through Web Audio kills lock-screen
playback, so the engine skips it there, and every visualizer drew black and
the needles sat at 0. Now every visualizer (Winamp's included) reads one
level source: the analyser on desktop and Android, and on iOS a level tap that
Range-fetches the same file, decodes 10 s chunks in an OfflineAudioContext
(no output, no audio session, cannot touch the lock screen) and serves
windows at the element's current time. It fetches only while a visualizer is
mounted, the page is visible and the show is playing. `e2e/meters.spec.ts`
was red first (every needle 0.00 on the iPhone profile), and asserts zero
`createMediaElementSource` calls on the iPhone. Covered sources: mirror,
archive.org (incl. the storage-node fallback via a sticky node), repaired
files.

**Growth.**
- Share sends `/show/<slug>`. Share this moment (both players) sends
  `/show/<slug>?t=<s>`: the page plays from that second (`#t=` works without
  JavaScript), canonical stays the plain show, and its card says "Starts at
  1:23:45". Open in High Desert carries the second into the app.
- Show and guest pages: one-tap Play, a line saying what the site is, Listen to
  the station now and Browse the Library, topics, related shows.
- 70 topic pages (`/topic/<slug>`, `/topics`): categories, 29 named subjects
  (Mel's Hole, Area 51, Roswell, remote viewing, ...) and tags on 10+ shows.
  Slugs add-only in `data/topic-slugs.json`.
- Tonight: `/tonight` redirects to today (Pacific); `/tonight/<day>` has the
  night's program in Pacific and local time, why each show is worth hearing,
  the date's broadcasts from other years and a Tune in, with its own card.
- All in the sitemap; `check:seo` covers topics, Tonight and moments.
- Fixed on the way: `?show=` told every first visitor "That show is not in this
  library" (the seed settles one render before its rows arrive).

**Phone.**
- Live on a phone, both looks: one card at the top with ON AIR, the show, "with
  Guest, year", a one-line hook (the cited notable reason, else the summary's
  first sentence; nothing invented) and one Listen live button. Below it Call
  in and the last three calls.
- Radio's old phone slot is Phone Lines in both looks (`/live?lines=1`).
- Continue listening tops the Library and the welcome screen.
- Install prompt from a second visit: the browser's Install where it offers
  one, Share then Add to Home Screen instructions on iPhone/iPad Safari,
  nothing in in-app browsers or the installed app. "Not now" twice ends it.


## Checks run here (no Actions)

On the final tree, through `heavy`, against a local build on the e2e database
with the phone-lines service behind `scripts/live-e2e-stack.mjs`, the way CI
composes it:

- `vitest run`: 277 files, 2,622 tests, all passed (database tests included).
- `eslint .` and `tsc --noEmit`: clean.
- Mutations: all 963 at `35a5117` went red (two worktrees, a shard each); the
  4 added after it and the 18 whose files changed since went red too. 967
  anchors, each found exactly once.
- Playwright, both projects: 192 passed, 0 failed, 40 skipped (the gated
  ones: real archive.org, production-only, the iPhone cases outside WebKit).
  The looks suite saves every screen in both looks to `test-results/looks/`.
- `check:csp`: 7 routes, no violations, no console errors, no em dashes.
- `check:seo`: 1,413 shows, 175 guests, 70 topics, 14 nights in the sitemap;
  45 pages, 782 links and 90 share images checked, no findings.

## How the look is chosen (foundation)

- The root layout is `src/app/[look]/layout.tsx`; both looks are prerendered
  (`generateStaticParams`), and an unknown look is `notFound()`. Pages render
  `<html data-look>` on the server, so there is no flash.
- **The cookie is read by a rewrite, not by the proxy.** `next.config.ts`
  `rewrites().beforeFiles`: `hd_look=night` goes to `/night/:path`, everything
  else to `/win98/:path`. A middleware rewrite was tried first and failed: a
  proxy rewrite must be an absolute URL, and the server's own origin
  (`-H 127.0.0.1`) differs from the request's, so Next proxied it externally
  (500, ECONNRESET) or threw `NoFallbackError`.
- `LOOK_PAGES` excludes the look prefixes themselves, because Next chains
  `beforeFiles` rewrites (`/win98/win98/...` otherwise).
- `src/proxy.ts`: `/radio` 308s to `/library?view=dial`; `/night/...` and
  `/win98/...` 308 to the plain path (a look is never a second URL); an invalid
  `hd_look` (the old signed HttpOnly preview cookie) and `hd_look_view` are
  deleted.
- Share cards stay outside the look segment (`src/app/show/[slug]/opengraph-image.tsx`
  etc.) and every page names its card explicitly in metadata.
- Retired: `/look`, the look pill, `/live-api/admin/look`, `look.mjs`,
  `scripts/look-cookie.mjs`, `HD_LOOK_KEY`, the old public look and its
  screenshot set, the Radio tab (`/radio` redirects).

## Found at integration: a hydration mismatch on every page

The visualizer agent reported Night never finishing its boot. A production
build of the integration branch showed React #418 on every page in both looks,
and the boot screen stuck on `/live`; `next dev` showed nothing, which is why
it got past the branches. Cause: pages render in the `[look]` segment through a
rewrite, so `usePathname()` read `/win98/live` while a page was prerendered and
`/live` in the browser. The empty player (hidden on `/live`) was in the server
HTML of `/live`, and the tab bar marked no tab. Fix: `useAppPathname()`
(`src/hooks/useAppPathname.ts`) takes the look off; ESLint bans `usePathname`
everywhere else (proved in `eslint-rules.test.ts`); two mutations. Rebuilt and
re-probed: no #418, boot screen clears, in both looks at 390 and 1280.

The e2e and test databases got the new `schema.sql` (look columns).

**Second find: every 404 drawn in the browser was a blank screen** (production
too, today, on e.g. `/show/no-such-slug`). `notFound()` on a dynamic route
arrives as an error shell; React draws the layout in the browser, and an inline
`<script>` React inserts never runs, so the boot script that dismisses
`#app-loading` never ran and "Signal Lost" sat under the overlay for good. The
screenshot suite passed a blank 404 because it waited for the overlay and
caught the timeout. Fix: `useDismissBootScreen()` in `not-found.tsx` and
`error.tsx`; a unit test with a control; two mutations; and every look screen
now asserts `#app-loading` is hidden (red on the old build, as it should be).

**Third find: the default look had never been through the accessibility
gate.** `e2e/a11y.spec.ts` ran only in the old public look; the first full e2e
run on the branch failed 21 of 202, and four were real AA misses in Win98:
white on the lit ON AIR red (3.83:1, now ink at 5.5:1), the dial's signal
readout faded to 1.01:1 on gray (now full-strength green), and the Library's
swipe tip at /85 on its own tint (4.34 and 3.98:1, now full strength, and it
says "Swipe a show" since Win98's phone rows are not cards). The a11y spec now
scans every page in both looks. The rest were specs written for the retired
look: `/radio` is the dial, the admin pages have no nav tabs in Win98 (reached
by URL), Win98's phone menu is Start, Export is Start > Settings > More
Settings. The Notepad now renders a call in the parts LiveChat names
(`line-label`, `caller-name`, `message-body`; text unchanged), so
`live-chat.spec` runs in Win98. `live-callers.spec` and the caller tests in
`live-qa.spec` choose Night: their rename is LiveChat's button, and the
Notepad's rename (Edit > Change Name...) is held by its unit test only.

**Fourth find: a reload of `/search` or `/scanner` sent an admin to
`/library`** (production too). The page's effect ran before the layout's
`hydrate()`, so it saw `isAdmin: false`. Win98 has no admin tabs, which made a
reload the only way back. Both pages now read the saved flag first; unit test
with a control, one mutation.

## Deploy (2026-10-12, 19:53 to 19:56 UTC)

PR #73, merged as `fc5fbbb` with `[skip ci]`: no Actions run on the PR or
on `main`.

1. `deploy-live.sh`: pre-schema dump, schema, verified (health, SSE hello
   through nginx, POST round trip). The admin look route is gone from the
   service.
2. `pg_dump` of `funnel_daily`, `arrival_daily`, `play_events`:
   `/root/backups/highdesert/pre-looks-20261012T195403Z.dump`.
3. `deploy.sh`, first attempt: **the staging build failed its type check**.
   `tsconfig.json` includes `.next/types/**`, the *live* build's route types,
   which still named the old `src/app/(desktop)/...` paths. The live site was
   untouched. I moved the live `.next/types` aside (declarations only, never
   read by the running server; kept in this session's scratchpad) and the
   second attempt deployed `fc5fbbb` cleanly. After this deploy the live types
   match the tree, so it does not recur; any later deploy that moves routes
   will hit the same thing until `.next/types` stops being in `include`.
4. **My mistake:** I applied `scripts/schema.sql` in the same command as the
   first `deploy.sh`, without stopping on its failure. So the old code ran on
   the new funnel/arrival keys from 19:55:10 until the restart at 19:56:17
   (67 s). Funnel and arrival writes in that window would have failed; the
   service log shows no errors in it.
5. `highdesert-status` after the deploy: one new FAIL, `presence`, "taskbar
   displays [17] but is tagged 17/7". The tray is right (online alone, like
   the badge); the live check's judge only knew the badge. Fixed in
   `scripts/presence-check.mjs`, with a test and a mutation, in the
   post-merge commit that carries this handoff, and redeployed.
6. Against production: `check:seo` (1,413 shows, 175 guests, 70 topics, 14
   nights; no findings), `check:csp` (no violations, no console errors, no
   em dashes), and `e2e/looks.spec.ts` (32 passed). The "after" screenshots
   of Live on a phone come from that run.

**Second mistake: a 150 MB file nearly went to GitHub.** My debugging
`next dev` (`HD_DIST_DIR=.next-dev`) wrote a turbopack cache that a later
`git add -A` committed; GitHub refused the push (GH001, 100 MB limit). Nothing
reached GitHub. I dropped `.next-dev` from the unpushed branch history with
`git filter-branch` over `origin/main..HEAD` only (the final tree was
byte-identical before and after) and added `/.next-dev/` to `.gitignore`.

## The resend loop (item 4)

It was this session's own scheduled wakeup. While waiting on CI for PR #72 I
armed a `ScheduleWakeup` fallback ("Check CI on PR #72 head 2e2ae04; if green
merge and deploy ..."). That put the session in the dynamic /loop mode, and the
runtime kept re-firing the same prompt into `claude-high-desert-1` after the
work was done: once at 05:25, and again at 05:46 under a new task id with no
new call from me. Stopped at 05:46:06 with `ScheduleWakeup({stop: true})`.
`CronList` showed no cron jobs. Nothing else on the box sends prompts: the
other sessions' loops (simsunday's tour checks, bambu-mcp's watcher) are their
own work, inside their own sessions. I no longer arm wakeups for background
work; the harness's own task notifications cover it.

## Hook blocks this session

Every one was `require-pipefail.py` (a pipe without `set -o pipefail;`). No
other hook or permission check blocked anything, and nothing was routed
around: each blocked command was re-run unchanged but for the prefix.

| Who | Blocks | Notes |
|---|---|---|
| me | 6 | live-setup link step, status checks, a `cat \| head` of the layout, three earlier |
| `feat/looks` agent | 11 | read-only `\| head`/`tail`/`grep` |
| `fix/meters` agent | 7 | also ran one `npx tsc` without `heavy` (house rule slip; later runs used it) |
| `feat/phone` agent | 6 | worktree setup, reads, an e2e wait loop |
| `feat/growth` agent | 7 | one was a heredoc that wrote a test file and piped vitest; the test file was then written with the Write tool and vitest re-run with the prefix. The block was the missing prefix on the pipe, not the file write |

## Incidents

- An `npx next start` killed by its own PID left `next-server` holding port
  3769. I checked the orphan's cwd was `/root/hd-full` and killed that PID;
  later servers ran under `setsid` and were stopped by process group.
- `pgrep -f` matched my own shell once (read-only, nothing killed).
- I ran one `tsc --noEmit` and an `eslint` of one spec without `heavy` while a
  build and a mutation shard held both slots (house rule slip).

## Not mine, noticed

- `sogojet-deploy-status` exits 1: SoGoJet prod has 88 undeployed commits, 16
  days old. Another project; left alone.

## Still left

- **On a real iPhone** (nothing here could): the meters move on an archive.org
  show, a mirror show (outage mode) and a repaired show, in both looks; they
  keep moving after pause/resume, a show change, and locking ~10 s; the
  lock-screen controls still drive the show; no Range requests while locked
  or paused (Web Inspector).
- `HD_LOOK_KEY` is still in `/root/.high-desert.env`. Nothing reads it now;
  harmless, removable.
- `tsconfig.json` still includes `.next/types/**` (see Deploy, step 3).
- The 7-day failure line reads WARN (21.0% of starts failed, 225 / 1,069);
  this release's own line is OK (1.7% lost). Not from this PR.
- `warm` WARN (289 of 328 pins, VPS disk at its floor) predates this PR.

- `feat/looks` used a private test schema `hd_looks` in `highdesert_test`;
  drop it after integration (`DROP SCHEMA hd_looks CASCADE`). The shared test
  DB needs `schema.sql` applied once.
- No direct mutation for the layout's `noteFunnelRevisit()` call or for
  TimelineView passing `look` (behaviour behind both is mutation-covered).
- `feat/phone`: a phone now connects to the chat stream on opening /live (the
  preview and the sheet share one stream), not on opening the sheet.
- Not checked on a real iPhone: the welcome page's Continue goes through
  `/library?resume=`, and Safari may drop the tap's permission on the way; if it
  does, the error dialog's Try Again restarts the show.
