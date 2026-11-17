# High Desert: what is next

Kept by the working session. Times are UTC. `## Queue` is the work, top
first, one line per item (the foreman's format); the dated notes below it are
the log, newest first. **No deploy window since 2026-11-17 (Jackson): each
item deploys as soon as its checks pass.**

## Queue

The five biggest improvements for listeners, chosen from the 30-day numbers
of 2026-11-17 (`/api/stats/usage`, the funnel line):

- [x] Ship the four built items together: **live 2026-11-17 21:55 UTC as `3dab517`**, with the default share card cached a week (`8bda37d`, check:seo caught it) and a new test for the fuzzy matcher (`703e8d2`, mutation `library-search-fuzzy-every-word` had survived). check:seo and check:csp pass on production. (branch `fuzzy-search`, worktree `/root/hd-fuzzy`, one item because they share one suite run, one build and one deploy): checks first (mutations, lint, typecheck, suite, build, csp/seo on the build), then merge to main, `deploy.sh`, csp/seo on production. In flight: lint and typecheck pass; the suite's failures are fixed or being rerun (`docs/handoff-2026-11-17-listeners.md` has the exact next commands). What it ships:
  - Show pages count their plays: 713 desktop views in 30 days and 0 plays recorded. One play per page load on the first `playing` (surface `show`), a heartbeat while it plays (`b035df5`)
  - Archive search forgives spelling: close spellings when nothing matches exactly, and "Did you mean" (`e4883e1`, `docs/library-search.md`)
  - Getting found on Google: `/shows` and `/shows/<year>`, linked from the show pages' frame and the welcome page, in the sitemap and `check:seo` (`1992a96`)
  - The player: Continue listening reads "Resume at 1:12:40 of 2:58:00", and the restored player shows where ▶ will start (`09b542c`). Not added to Live on purpose: a phone's Live screen has one big button
- [x] Right after the ship above lands, start the envelope timer: `systemctl start highdesert-level-envelopes.timer` (Jackson, Inbox, 2026-11-17: "Start the envelope timer right after the fuzzy-search ship lands. No need to ask."). Its `hd-requeue-*` timers from the 18:00 log never existed Done: the timer was already active when the ship landed (next run 22:01).
- [x] The phone look split: **live with the ship (`3dab517`)**, assigning from 2026-11-18 00:00 UTC to 2026-12-02 00:00 UTC (`src/lib/look/split.ts`, `docs/funnel.md` "The phone look split"). Checked in a real browser on the build: 12 new phones split 7/5, each kept its look; desktops, crawlers and days outside the window untouched. Seven mutations red.
- [x] sang3r.com export (the lead, 2026-11-17): `mode=daily` gains `visitors`/`views`, new `mode=detail&days=7|30|90`, and not-audience exclusions at write time (agents, `X-Sanger-Internal`, `sanger_me=1`, the box itself). **Live 2026-11-17 as `a2e049a`**; sanger-75 told the URL and shape. `visitors` reads null through 2026-11-17 (the counter's partial first day)
- [x] **Live 2026-11-17 23:03 UTC as `d57fe0c`** (fixed in `68e7565`): the fetch now asks `next: { revalidate: 60 }`; test `manifest-fetch.test.ts` (red before the fix), mutation `live-manifest-fetch-static-safe` red. On a local build on the e2e database, with today's row cleared, `/tonight/2026-11-17` froze the day and answered 200 twice. A Tonight page that is first to freeze a day answers 500: `frozenDay()` reaches `mirrorManifest()`, a `cache: "no-store"` fetch, inside an ISR render ("Page changed from static to dynamic at runtime"). Seen on a local build on the e2e database (2026-11-17); production had its days frozen by the schedule API first. Fix: give the manifest fetch `next: { revalidate: 60 }` (it is memoised 60 s anyway), with a test

## Waiting for a date

Not read by the foreman (it has no date gate, so these sat at the top of the Queue and were sent before their day). On or after the date, move the line back under `## Queue`.

- [ ] Not before 2026-11-25 (a week after the 2026-11-17 deploy): `playsBySurface.show` in `/api/stats/usage?days=7` is above 0, and Search Console's Pages report shows `/shows/*` indexed
- [ ] Not before 2026-12-02: read the phone look split (`docs/funnel.md`, "The phone look split", the psql query there): Live, tune-in and return per look, phones, cohorts 2026-11-18 to 2026-12-01. Write the verdict there and remove `LOOK_SPLIT_SCRIPT` from the head (it does nothing after the window, but it is dead code)

## Needs Jackson

- [ ] The skipped weekly mutation run: start it tonight at 03:05 UTC, or let Monday 2026-11-23's run cover it (Inbox `hd-mutations-requeue-2026-11-17`). The status `mutations` line WARNs until one finishes

## Log

## 2026-11-17, 23:30: date-gated items moved out of the Queue

- The foreman sent the 2026-11-25 item on 2026-11-17: `next.ts` has no
  date gate. Both dated items now sit under `## Waiting for a date`, a
  note heading, so the Queue is empty until one is due.

## 2026-11-17, 23:20: after the clear

- Queue: only the two date-gated items. `highdesert-status` exits 0, one
  WARN (`mutations`, 8 days).
- The 18:00 note's `hd-requeue-mutations` timer never existed. A
  `systemd-run --on-calendar` timer to start `highdesert-mutations` at 03:05
  was refused by the auto-mode classifier; not retried. Filed in the Inbox
  instead (above). The envelope timer is active and holds the heavy slot.

## 2026-11-17, 23:15: the Tonight 500 fixed and live

- `68e7565`: the mirror manifest fetch revalidates at 60 s instead of
  `no-store`. Suite: 3,029 tests passed; the 13 files that failed at import
  (`services/live` not installed in the worktree) passed after its `npm ci`
  (290 tests).
- **The first deploy rolled back** on WebKit's returning visitor: one page
  error, `/api/live/time due to access control checks`, the clock sync cut
  off by the check's own navigation (the app catches it in `syncClock`).
  `d57fe0c` adds that one route to `NAVIGATION_NOISE` (test red without it,
  mutations `returning-noise-clock-sync` and
  `returning-noise-not-every-live-route` red). The second deploy passed in
  both browsers.
- check:seo (49 pages) and check:csp (8 routes) pass on production;
  `highdesert-status` exits 0 (one WARN: the weekly mutation run, skipped
  this week). Station notice posted 23:12.
- The e2e database's 2026-11-17 row was cleared to reproduce the freeze; the
  build froze it again.
- Queue: only date-gated items are left (2026-11-25, 2026-12-02).

## 2026-11-17, 18:30: the listener queue, items 1 to 5

- Items 1, 2, 3 and 5 are built on one branch (`fuzzy-search`, with item 1's
  `show-page-plays` merged in), so one suite run and one build cover them
  on a busy box (the Level envelope batch holds High Desert's heavy slot for
  minutes per show).
- Item 4 is a decision for Jackson (above).
- The rebased `show-page-plays` was not force-pushed (the push was refused).
  It ships through the merge.

## 2026-11-17, 18:00: envelopes and mutations moved to tonight

At the lead's request (the heavy queue was jammed), I stopped the Level
envelope batch and its hourly timer (116 envelopes kept) and the weekly
mutation run. Two transient timers re-queue them one at a time after 22:00 ET:
`hd-requeue-mutations` (03:05 UTC, starts `highdesert-mutations`) and
`hd-requeue-envelopes` (05:30 UTC, starts `highdesert-level-envelopes.timer`
again). The status `mutations` line may WARN until tonight's run finishes.

## 2026-11-17, 15:30: deployed, green

- **Jackson approved deploying today** (Inbox `hd-deploy-2026-11-17`), so
  the 09:31 timer for tomorrow was cancelled and `deploy.sh` ran at 15:08.
  Live is **`9474f79`** (deployed 15:22:16): Level (two-pass), Next.js
  16.4.6, the shorter Sim Sunday spot and the pull of 1998-03-05. The client
  check passed on `/`, `/library`, `/live`, `/stats`, and the returning
  visitor did too in Chromium and WebKit. The schema was applied, and nothing
  rolled back.
- **`highdesert-status` exits 0.** The `deploy` line reads OK (live = HEAD).
  The one WARN is `steal` at 24% (a busy box with nine heavy jobs queued; not
  ours to fix).
- `check:seo` and `check:csp` against production both pass (8 routes, no CSP
  violations, no console errors, no em dashes).
- **Level on production:** `/api/level/envelope` answers 200 for a show with
  an envelope (1992-12-12 Area 51) and 404 `none` for one without (1994-03-12
  Philadelphia Experiment), so the player uses the live leveler there. 101
  envelopes so far. I did not check the `data-level-source` attribute in a
  browser, because that would play a show on production and count it.
- Station notice posted announcing Level (15:24).

## 2026-11-17, 14:30: the deploy moved to tomorrow

- **The 09:20 deploy did not run.** The session was idle from 08:18 until
  13:59, when the timer's prompt reached it. Jackson's rule is 4:30am Eastern
  except for an incident, and the site was up (build `f315027`, 20 online), so
  it is set for **Wed 18 Nov, 09:31 UTC** (a one-shot session timer: if this
  session is cleared or exits first, nothing starts it). Inbox item
  `hd-deploy-2026-11-17`: Approve deploys today instead.
- **The pull of 1998-03-05 "Hollywood and UFOs" is on main** (`2289794`) and
  ships with that deploy. Lint, typecheck, and the full suite passed (four
  timeouts during the weekly mutation run passed on a re-run, 168 of 168).
  Besides the four documented steps, it was in three community lists
  (sources, categories, hosts); `docs/broken-episodes.md` has the record.
- **The weekly mutation run is running again** (started 14:00).

## 2026-11-17, the night round (until 14:00 UTC)

### State at 08:15

- **The site is up.** highdesert.space answers 200 and runs build `f315027`.
  The last deploy (2026-11-15 19:28) succeeded. Nothing is stuck or failed.
- **The status check's one FAIL is `deploy DRIFT`**, not a failed deploy:
  30 commits on main are not deployed yet. That is the morning deploy below.
  Every other line of `highdesert-status` reads OK.
- **Tests: fixed, 335 files, 3,237 passed** on main (`83d119a`).
  - The hub's failure was the Sim Sunday spot at 20.64 s against the 20 s
    ceiling. Re-rendered at 19.49 s (`e2461f1`).
  - A second, intermittent failure: the Request Line test could land its
    random day on a Noory nomination left in the test database by an earlier
    run. The test now clears those rows before and after (`83d119a`). No
    assertion changed.
  - Three 5 s timeouts showed only in a run made while the box was busy.
    They pass in a clean run and may recur under load.
  - The hub's triage item closes by itself when its next check passes.

### Owed

1. **The deploy at 09:21** (a one-shot session timer; the shell wait was
   stopped twice by the low-memory reaper). It ships Level (two-pass), Next.js
   16.4.6 and the shorter Sim Sunday spot. Steps: `STATUS.md` in
   `docs/level-two-pass-2026-11-16/`, "For the next session". The heavy queue
   is long tonight (six jobs waiting at 08:12), so the build may start late.
2. **Pull 1998-03-05 "Hollywood and UFOs"** (branch `pull-hollywood-ufos`,
   worktree `/root/hd-pull`). archive.org took its item down (`is_dark`, 403
   since 2026-11-14, no other copy found, not on the mirror). The station cut
   it by hand on 2026-11-14 and its pre-air record still says ok, so it could
   air again. Tests are running; it ships with the deploy if they pass in time,
   otherwise after.
3. **The weekly mutation run** of 2026-11-16 was killed by the reboot. I
   started it at 08:00 and stopped it again to keep the heavy slots for the
   deploy. Restart after the deploy: `systemctl start --no-block
   highdesert-mutations`. The status line turns WARN at about 15:46 without it.

### Hook blocks tonight

- pipefail hook: a pipe inside an `ssh` command. Nothing ran. Re-issued
  without the pipe.
- npm hook: an `npm ci` inside a subshell after a `;`. Nothing ran. Re-issued
  as `cd <worktree> && npm ci`.
