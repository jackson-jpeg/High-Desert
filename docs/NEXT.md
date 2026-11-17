# High Desert: what is next

Kept by the working session. Newest first. Times are UTC.

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
