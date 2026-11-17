# High Desert: what is next

Kept by the working session. Newest first. Times are UTC.

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
