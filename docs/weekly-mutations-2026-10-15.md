# High Desert, 2026-10-15: weekly mutations on the VPS, and a disk sweep

## What you asked for

1. **Mutations:**
   - Run the full list on the VPS every Monday at 14:00 UTC, through
     `heavy`.
   - Point the status `mutations` line at that run.
   - Put it in the Monday digest.
   - Test it end to end once now.
2. **Disk:**
   - Run disk-sweep now, with the Sim Sunday and Bambu exclusions.
   - Report free space before and after.
   - Add anything growing fast to the weekly sweep.
3. **Your follow-up:**
   - Exempt the weekly run from the 10% rule, so `heavy` alone holds it.
   - Add `~/.npm` to the weekly sweep: npx installs and cache entries
     older than 7 days.
   - Run it once now.

## Disk

| Step | Free before | Free after | Freed |
|---|---|---|---|
| disk-sweep as it was | 13.84 GB | 14.00 GB | 156 MB |
| disk-sweep with the new npm step | 13.95 GB | 15.53 GB | 1.58 GB |

**What grows fast:**

- **npm's caches in `/root/.npm`.** Mostly npx installs, about 2.5 GB in a
  day.
  - The weekly sweep didn't cover them before. Now it does: step 5 in
    `vps-tools/bin/disk-sweep`, commit e08dd8c.
  - npx installs go once they were installed more than 7 days ago. Age is
    the newest of the folder, its `package.json` and its lockfile.
  - Cache content goes once it was written more than 7 days ago. Then
    `npm cache verify` drops the index entries left pointing at nothing.
  - It never removes an install a running process uses, or anything whose
    path or `package.json` names Sim Sunday, Bambu or `.venv-cad`.
  - Today's 1.5 GB prisma npx install is new, so it stays until it's 7
    days old.
  - Tests: `vps-tools/tests/disk-sweep.test.sh`, 27 checks, all pass.
- **Sim Sunday and Bambu temp dirs.** They grow too, but they're excluded
  by your rule and I left them alone.

**Why age, not last use:** I first tried pruning npx installs by when they
were last read (access time). That signal turned out to be broken:

- My own `jq` read of the installs updated their access times.
- Something else had read them all on 10-11.

So the step goes by install and write time, which nothing updates except
a real install.

## The weekly mutation run

**Where it runs:**

- `highdesert-mutations.timer` fires Mondays at 14:00 UTC (`Persistent`,
  so a missed Monday runs at the next boot). It starts
  `highdesert-mutations.service`, which runs `scripts/weekly-mutations.sh`.
- The run uses its own clone of main in
  `/var/lib/highdesert-mutations/checkout`, never the production tree,
  because mutate-check edits the files it breaks.
- `npm ci` runs there only when a lockfile changes, and through `heavy`.
- Schemas go into the test database first, which must be a `*_test`
  database.

**CPU:**

- Every mutation's Vitest takes the `heavy` slot, so the 40% gate is
  checked before each one and other jobs take turns with it.
- The unit is `Nice=19` with idle IO and no `CPUQuota`, as you chose.
- The status `cpu` line names it as the one exemption, for example
  "highdesert-mutations 9.9% (exempt: the weekly mutation run, held by
  heavy)". It's also in `hd-cpu-sample`'s unit list, commit bbfcedb.

**What it leaves:**

- `result.json`: the commit, when it finished, the total, the reds, the
  survivors, and an error if it broke before checking anything.
- `running.json`: there only while a run is going.
- The last 8 runs, kept in `runs/`.
- The log: `last.log`.

**Status `mutations` line:**

- **OK:** "weekly full run on SHA (when, took XhYm): all N mutations red".
- **FAIL:** a mutation survived or went stale. The line names each one.
- **WARN:**
  - the run broke before checking;
  - database mutations were NOT CHECKED;
  - the last run is over 8 days old;
  - no finished run yet.
- While a run is going, the line adds "a run has been going since …".

**Digest:** Health ends with one line for the run: its commit, when it
finished, how long it took, and either all red or what survived or broke.
A survivor also heads Needs you, because status FAILs.

**Retired:** the GitHub nightly reader (`scripts/nightly-mutations.sh`)
and its two mutations.

**mutate-check:**

- New `--json <file>` flag, which writes the result atomically.
- 1,080 entries.
- The new status, cpu, runner and digest code each has mutations.

## End-to-end test

**Run 1** on cdbff2f, started with
`systemctl start --no-block highdesert-mutations`.

- **Ran 21:05 to 22:26 UTC, 1h21m.**
- **1,079 of 1,080 red, one STALE: `status-cpu-threshold`.**
  - My cpu-exemption change rewrote the awk line that the mutation
    anchors on, so it no longer matched.
  - The weekly run caught a real defect on its first try.
- **That run tested the failure path.**
  - Status `mutations` read FAIL and named the entry and the log.
  - The digest preview put it under Needs you, with the fix to make.
  - The digest's Health line read: "1 of 1080 survived or went stale:
    status-cpu-threshold [STALE]."
- **The fix (b248334):** I re-anchored the entry. All three cpu
  mutations go red.

**Run 2** on b248334.

- **Ran 22:30 to 23:48 UTC, 1h17m.**
- **All 1,080 red.**
- **Status:** "OK mutations weekly full run on b248334 (2026-10-15T23:48:34Z,
  took 1h17m): all 1080 mutations red".
- **Digest Health line:** "Mutations: weekly full run on b248334 (Thu 15
  Oct, 23:48 UTC, 1h18m): all 1080 mutations red." The digest rounds the
  minutes and status truncates them, which is why the times differ by one
  minute.
- **While running:**
  - Status read WARN "no finished weekly run yet …; a run has been going
    since 21:05:32Z" before the first run finished.
  - The `cpu` line named the exemption each time instead of failing.

**What it costs:**

- **CPU:** close to one full core for about 80 minutes. That's 76% to 98%
  of a core in the 15-minute means, about 1.3 CPU-hours.
  - The 6-hour mean rose from 19% to 32%. The `heavy` gate (40%) stayed
    open throughout.
  - Two runs back to back is the worst case. A normal Monday is one.
- **Disk:**
  - The checkout and its `node_modules` take a steady 1.0 GB in
    `/var/lib/highdesert-mutations`.
  - The first `npm ci` added about 1.3 GB to `~/.npm`. The new weekly sweep
    prunes that after 7 days, and `npm ci` runs again only when a lockfile
    changes.
  - Free space now: 14.4 GB, just under status's 15 GB WARN line.

**Next scheduled run:** Monday 2026-10-19 14:00 UTC. The timer is enabled.

## Still open

- **Deploy drift:**
  - Status `deploy` reads FAIL (DRIFT): the live build is 21eb3a9, and
    cdbff2f and b248334 changed `scripts/` and `deploy/`.
  - The website itself didn't change, so I didn't deploy, as you said.
  - The next deploy clears it. I can run it in the 08:30 UTC window if you
    want.
- **Lint warning:** one warning that was already there before this
  session, not from this change.
- **Local suite, two known environmental failures:**
  - the backup-db test, because the test database dump is over 1 MB;
  - the `services/live` test files, which don't load because the
    production tree has no `node_modules` there, by design.
  - The weekly checkout installs both, so the weekly run isn't affected.

## Blocks hit

- **The pipefail hook refused four piped commands** that lacked
  `set -o pipefail`:
  - a `sed | grep` read;
  - the disk-sweep test run piped to `tail`;
  - the hd-cpu-sample test piped to `tail`;
  - the watcher's `cat | head`.
- **Two more after the first run finished**, for the same reason: reading
  the result through `jq`, and a `grep | head`. The hook escalated the
  second refusal because it was a repeat. Both were rerun with
  `set -o pipefail;` and no other change.
- Each was rerun with `set -o pipefail;` in front, or without the pipe.
- **A slip of mine:** I ran the 8-test `service-unit.test.ts` (242 ms)
  with `npx vitest` directly instead of through `heavy`.
- No other hook or permission check blocked anything.
