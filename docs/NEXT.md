# High Desert: what is next

Kept by the working session. Times are UTC. `## Queue` is the work, top
first, one line per item (the foreman's format); the dated notes below it are
the log, newest first. **No deploy window since 2026-11-17 (Jackson): each
item deploys as soon as its checks pass.**

## Queue

The five biggest improvements for listeners, chosen from the 30-day numbers
of 2026-11-17 (`/api/stats/usage`, the funnel line):

- [ ] Ship the four built items together (branch `fuzzy-search`, worktree `/root/hd-fuzzy`, one item because they share one suite run, one build and one deploy): checks first (mutations, lint, typecheck, suite, build, csp/seo on the build), then merge to main, `deploy.sh`, csp/seo on production. In flight: lint and typecheck pass; the suite's failures are fixed or being rerun (`docs/handoff-2026-11-17-listeners.md` has the exact next commands). What it ships:
  - Show pages count their plays: 713 desktop views in 30 days and 0 plays recorded. One play per page load on the first `playing` (surface `show`), a heartbeat while it plays (`b035df5`)
  - Archive search forgives spelling: close spellings when nothing matches exactly, and "Did you mean" (`e4883e1`, `docs/library-search.md`)
  - Getting found on Google: `/shows` and `/shows/<year>`, linked from the show pages' frame and the welcome page, in the sitemap and `check:seo` (`1992a96`)
  - The player: Continue listening reads "Resume at 1:12:40 of 2:58:00", and the restored player shows where ▶ will start (`09b542c`). Not added to Live on purpose: a phone's Live screen has one big button
- [ ] Right after the ship above lands, start the envelope timer: `systemctl start highdesert-level-envelopes.timer` (Jackson, Inbox, 2026-11-17: "Start the envelope timer right after the fuzzy-search ship lands. No need to ask."). Its `hd-requeue-*` timers from the 18:00 log never existed
- [ ] The phone look split, approved (Jackson, Inbox, 2026-11-17: "Run the 50/50 split for 2 weeks on new phone visitors only."). A browser on a phone (narrower than 768 px) with no `hd_look` cookie and no prior visit gets Win98 or Night at random, once, recorded as its cookie; returning visitors, desktops and crawlers are untouched (crawlers stay Win98). The funnel already records the look; add the assignment's start date to `docs/funnel.md` and a dated item to read the result 2 weeks after it ships (Live → tune-in by look, phones, cohorts since the start). Build in its own worktree after the ship above
- [ ] Not before 2026-11-25 (a week after the deploy above, which has not happened yet; nothing to do until then): `playsBySurface.show` in `/api/stats/usage?days=7` is above 0, and Search Console's Pages report shows `/shows/*` indexed

## Needs Jackson

(nothing open: the phone look split was approved 2026-11-17 and moved to the Queue)

## Log

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
