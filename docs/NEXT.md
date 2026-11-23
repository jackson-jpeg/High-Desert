# High Desert: what is next

Kept by the working session. Times are UTC. `## Queue` is the work, top
first, one line per item (the foreman's format); the dated notes below it are
the log, newest first. **No deploy window since 2026-11-17 (Jackson): each
item deploys as soon as its checks pass.**

## Queue

Work order of 2026-11-22 (the lead; `docs/handoff-2026-11-22-ship.md`):

- [x] **Live 2026-11-22 as `8c2d1de`**: supporter Joseph K., $50, at the top (tests, 3 mutations red, lint, typecheck, shoutout dry run names him); repo name `jackson-jpeg/High-Desert` in README, CLAUDE.md, package.json, the sampler unit
- [x] **Live 2026-11-22 as `dacac34`: supporter tiers on /stats** (Jackson, 01:41 ET). `supporters-*` 8/8 and `shoutout-*` 10/10 mutations red, lint, typecheck, build, returning visitor ok in both browsers. Verified 07:2x: /stats's supporters panel rendered on production at 390 and 1440 in both looks (four tiers in order, no overflow, no em dash) and check:csp on production clean (`docs/handoff-2026-11-22-tiers.md`)
- [x] **Confirmed 2026-11-22 07:2x**: status `presence` reads OK (desktop /library, desktop /stats, mobile /stats agree) after the ship below; `presence-check.mjs` knows `live` surfaces (test, 2 new mutations, 5/5 red)
- [x] **Live 2026-11-22 07:14 UTC as `57c4a95`**: ship round 2 items 3, 4, 5 (show pages' Next, mutate-check atomic writes, Request Line on desktop). Rebased on main, `npm run build`, `e2e/request-line.spec.ts` on a local build on the e2e database (9 passed, 11 skipped by the spec's own project filters), check:seo/csp on the build and on production, a show page's Next read back from production (John Lear's 1993-09-03 after 1992-12-12, reason `guest`), returning visitor ok in Chromium and WebKit; station notice 07:2x. The tiers item's leftovers are done too: /stats's supporters panel rendered on production at 390 and 1440 in both looks (four tiers in order, no overflow, no em dash), check:csp on production clean

Round 2 (the lead, 2026-11-18): the next five for listeners, from the 30-day
numbers of 2026-11-18 00:40 UTC (`/api/stats/funnel?days=30`,
`/api/stats/usage?days=30`). The gap is desktop: 1,789 first visits, 21% saw
Live, 12% tuned in, 7% came back; phones 1,224, 79%, 37%, 23%. A new desktop
visitor lands on the Library (1,417 of 1,789 direct desktop arrivals land on
the Library or a show page) and meets the station only as the bar at the
bottom. Phones are left alone until the look split's verdict (2026-12-02).

- [x] **Live 2026-11-18 01:15 UTC as `107fd60`** (suite, build, `e2e/station-welcome.spec.ts` 4/4 at 1440 in both looks, check:seo/csp on the build and on production; station notice 01:18). Desktop, the station first: a new desktop visitor (empty library, first visit) to the Library sees an "On the air now" window above the list, both looks: the show, "with Guest · year", the hook (`showHook()`, never invented), time left, "N tuned in now", one Listen live button (`tuneIn()` in the gesture). Dismissed it stays dismissed; never once the browser has tuned in. Goal: desktop tune-in from 12% toward 20% of first visits (funnel `byDevice.desktop`, cohorts from the deploy); test, mutation, e2e at 1440 in both looks
- [x] **Live 2026-11-18 03:28 UTC as `34e1085`** (own tests 14/14, `first-sort-*` mutations 6/6 red, lint, typecheck, suite (only load timeouts in untouched files), build, library e2e specs and station-welcome 44 passed on a local build, check:seo/csp on the build and on production; screenshots in `Assets/2026-11-18-library-first-order/`; station notice 03:32). The Library's first order for a new visitor: newest first opens on December 2015 Midnight in the Desert specials. With no sort ever chosen and an empty history, lead with the shows people play (the community "Most played", or Notable, whichever reads better on the first screen), keeping any sort the visitor picks. Measure library plays per first visit before and after

Round 1, the five biggest improvements for listeners, chosen from the
30-day numbers of 2026-11-17 (`/api/stats/usage`, the funnel line):

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

**How the three paused items are checked** (the lead, 07:06 UTC: the 6-hour CPU mean at 71.8%, gate shut; Jackson's standing preference, size testing to the change): per item, only the tests and mutations that cover it, plus lint and typecheck on the changed files. Items 3 and 5 then ship **together in one deploy**: merge both, then ONE full suite and ONE `npm run build` right before `deploy.sh`, then the e2e specs they touch on that build. Item 4 (scripts only, no deploy) gets its own three test files and two mutations, never the full suite.

- [x] Not before 2026-11-18 06:00 UTC: the re-run of this week's mutations (`hd-requeue-mutations.timer`, 03:05 UTC, approved by Jackson in the Inbox 2026-11-17) finished, and `highdesert-status`'s `mutations` line reads OK. A survivor: fix it (test or mutation) as a Queue item (done 2026-11-19 23:5x, sanger-1: the six that went stale were re-anchored in 75ab96a, each red when run; the `mutations` line reads OK after the next weekly run, Mon 2026-11-23 14:00 UTC, which closes triage c8fce546. Also 503d6e6: request-line.db.test.ts moved to 2098 so its cleanup stops racing live-days.db.test.ts)
- [ ] Not before 2026-11-25 (a week after the 2026-11-17 deploy): `playsBySurface.show` in `/api/stats/usage?days=7` is above 0, and Search Console's Pages report shows `/shows/*` indexed
- [ ] Not before 2026-12-02, after the verdict below: apply it as the phone default if one look wins, both looks kept (round 2, item 5)
- [ ] Not before 2026-12-02: read the phone look split (`docs/funnel.md`, "The phone look split", the psql query there): Live, tune-in and return per look, phones, cohorts 2026-11-18 to 2026-12-01. Write the verdict there and remove `LOOK_SPLIT_SCRIPT` from the head (it does nothing after the window, but it is dead code)

## Needs Jackson

(nothing open)


## Log

## 2026-11-23, 04:5x: still holding (nineteenth context call)

- Nothing done, nothing in flight; Queue empty. `mutations` FAIL is the
  2026-11-18 run (fixed in 75ab96a); re-read after today's 14:00 UTC run.
  Handoff: `docs/handoff-2026-11-22-tiers.md`.

## 2026-11-23, 04:4x: still holding (eighteenth context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  This context call came minutes after a /clear with the context nearly
  empty, so the 90% reading looks wrong (the loop sanger filed at 03:54).
  Handoff: `docs/handoff-2026-11-22-tiers.md`.

## 2026-11-23, 04:3x: still holding (seventeenth context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`.

## 2026-11-23, 04:3x: still holding (sixteenth context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`.

## 2026-11-23, 04:1x: still holding (thirteenth context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Loop cause already filed by sanger (03:54). Handoff: `docs/handoff-2026-11-22-tiers.md`.

## 2026-11-23, 04:2x: still holding (twelfth context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding, 04:2x (twelfth)".

## 2026-11-23, 04:1x: still holding (eleventh context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding, 04:1x (eleventh)".

## 2026-11-23: still holding (tenth context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding (tenth)".

## 2026-11-23, 04:0x: still holding (ninth context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding, 04:0x (ninth)".

## 2026-11-23: still holding (eighth context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding (eighth)".

## 2026-11-23: still holding (seventh context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding (seventh)".

## 2026-11-23, 03:5x: still holding (sixth context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding, 03:5x (sixth)".

## 2026-11-23, 03:5x: still holding (fifth context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding, 03:5x (fifth)".

## 2026-11-23, 03:4x: still holding (fourth context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding, 03:4x".

## 2026-11-23, 04:0x: still holding (third context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding, 04:0x".

## 2026-11-23, 03:5x: still holding (second context call)

- Nothing done, nothing in flight; Queue empty, the lead's hold stands.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding, 03:5x".

## 2026-11-23, 03:4x: still holding (context call)

- Handoff note written on the foreman's context call; nothing in flight.
  Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding, 03:4x".

## 2026-11-23: still holding

- Foreman's continue after the clear: Queue empty, the lead's hold stands.
  Nothing in flight. Handoff: `docs/handoff-2026-11-22-tiers.md`, "Still holding".

## 2026-11-23, 03:3x: holding

- The lead's hold (02:0x UTC, usage 88%, resets Thu 2026-11-26 11:00 UTC):
  no new work until it lifts. Queue empty. The 2026-11-25 item waits for the
  end of the hold. Handoff: `docs/handoff-2026-11-22-tiers.md`, "Holding".

## 2026-11-22, 07:30: the ship branch live, the Queue empty

- `ship-2026-11-22` rebased on the tiers commits (no conflict), built,
  checked on a local stack (e2e request-line, seo, csp), fast-forwarded into
  main and deployed as `57c4a95`. Production seo and csp clean, presence OK.
  The force-push of the rebased branch to origin was refused by the auto-mode
  classifier; not retried (main was fast-forwarded and pushed instead, so the
  branch on origin is stale and can be deleted).
- `highdesert-status`'s only FAIL is `mutations` (six stale anchors from the
  2026-11-18 run, re-anchored in 75ab96a); it clears with the weekly run on
  Mon 2026-11-23 14:00 UTC.
- What is left is under "Waiting for a date" (2026-11-25, 2026-12-02).

## 2026-11-18, 07:25: paused until 2026-11-19 afternoon

- Jackson, via the lead, 07:20: High Desert is off tonight for the iPhone
  apps and sang3r. Nothing of mine runs or is queued. Items 3 to 5 re-gated
  to tomorrow afternoon. `docs/handoff-2026-11-18-paused.md`.

## 2026-11-18, 06:00: after the clear, still light duty

- The foreman sent "continue" at 05:56. Items 3 to 5 need only checks, and
  the lead's light duty (no vitest, tsc, eslint, build, Playwright,
  mutate-check, npm ci from High Desert) runs to 12:00 UTC; the heavy gate
  was shut as well (66.4% over 6 h). All three moved under `## Waiting for
  a date` with a 12:00 gate, so the foreman does not send them early and
  park them. Read-only review of `mutate-atomic`'s diff: both anchors are
  found once (escaped in the list), restore is synchronous; nothing to change.

## 2026-11-18, 05:40: handoff

- `docs/handoff-2026-11-18-light-duty-2.md`. Light duty until 12:00 UTC:
  items 3, 4 and 5 are built and pushed, each waiting only for its checks.
  The lead's stop orders and a tmux keypress into claude-sanger-1 were
  refused by the classifier and not retried.

## 2026-11-18, 05:00: the hub's test failure, item 5 built

- The hub's re-check on `dbbdc67` failed on one test only: show pages "for
  every show" (all 1,412 in one 60 s test) timed out at load 30 to 40.
  `4515246` (on main) splits it into chunks of 100, 60 s each, with a test
  that the chunks cover the catalog once. Not run here (light duty);
  syntax-checked. The hub's next re-check is its first run.
- Item 5 built on `desktop-request` (above). Checks wait for light duty.

## 2026-11-18, 04:20: light duty, the lead's cancel order

- The lead asked me to cancel the queued `high-desert mutation` (the
  re-run Jackson approved) and the envelope job unless it was within 5 min.
  `systemctl stop highdesert-mutations` was **refused by the auto-mode
  classifier**. I did not try another route. The run is still waiting for a
  slot with `src/proxy.ts` mutated in its own checkout, which is normal
  mid-run. If it is stopped, `git checkout -- src/proxy.ts` there (the
  checkout runs the old non-atomic restore).
- The envelope batch finished at 04:17:25 (4 ok, 0 failed, 1,244 left). The
  hourly timer started another at once, which waits behind the mutation.
- Item 4 built (`mutate-atomic`, `34ec586`), checks after light duty.

## 2026-11-18, 03:35: round 2 item 2 live

- `popular-first` merged and deployed as `34e1085` (returning visitor ok in
  Chromium and WebKit; check:seo and check:csp pass on production; notice
  03:32). Baseline for the measure is in `docs/funnel.md`, "The Library's
  first order".
- The envelope run waiting since 02:18 was stopped at the line lead's word;
  the hourly timer queued one fresh run at once (03:21:52).

## 2026-11-18, 02:15: tests failing (triage 716387f0), timeouts under load

- The hub's run on `20f70f2` failed only on `e2e-tokens` past 5 s, fixed in
  `107fd60`. With the box at load 12 to 53, `status.test.ts` and
  `backup-db.test.ts` (real shell scripts per test, 1 to 4 s each alone) ran
  past 5 s too, a different test each run. Both files now take 30 s per test
  (`vi.setConfig`); 138 of 138 pass at load 10 to 20.

## 2026-11-18, 01:20: round 2 item 1 live

- `desktop-on-air` rebased on main and checked: lint (warnings only),
  typecheck, the suite (3,045 passed; the 13 files that failed at import were
  `services/live` uninstalled in the worktree and passed after its `npm ci`,
  290 tests, `e2e-tokens` within its new 30 s), `npm run build`, the new e2e
  spec on a local build on the e2e database (4/4), check:seo (no findings)
  and check:csp (no violations; 404s only from `/live-api`, which a bare
  `next start` lacks) on that build. Merged fast-forward, deployed
  (`107fd60`, the returning visitor ok in both browsers), check:seo and
  check:csp pass on production, station notice posted 01:18.
- Item 2 built on `popular-first` (`/root/hd-popular`, `169938e`), checks
  not yet run: `docs/handoff-2026-11-18-popular.md`.

## 2026-11-18, 00:50: the stale triage item, the sang3r stats, round 2

- Triage "high-desert: deploy failing" quoted the daily portfolio run of
  2026-11-17 08:29 (31 commits undeployed then). Live is `d57fe0c` and the
  `deploy` line reads OK. Its status output is refreshed only by the daily
  run, so High Desert's checks were re-run with
  `SANGER_PORTFOLIO_ONLY=high-desert node scripts/portfolio-checks.mjs` (in
  /root/Sanger) to refresh it; the triage sync closes the item on its next
  round.
- sang3r.com already reads `mode=daily` (visitors, views). `mode=detail` is
  wired by sanger-75 on Sanger's side (asked and agreed 2026-11-18 00:4x);
  nothing needed here.
- Round 2 of the Queue written from the 30-day numbers (above).

## 2026-11-17, 23:50: the mutation re-run, approved

- Jackson approved it in the Inbox ("run it tonight under the heavy lock,
  and create the missing weekly timer"). `hd-requeue-mutations.timer`
  (transient, one shot) starts `highdesert-mutations` at 03:05 UTC; each
  mutation's vitest takes the heavy slot. The weekly
  `highdesert-mutations.timer` was never missing: enabled, next run
  2026-11-23 14:00 UTC, versioned in `deploy/`. The one that never existed
  was the 18:00 one-shot re-run, now made.

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
