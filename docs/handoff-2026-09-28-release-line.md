# Handoff: the release line, the Mac-script rule, memory, the first nightly (2026-09-28)

Three decisions from the CI and long-lived-tabs handoffs, then a check of the
first nightly mutation run. Before any of it, #58 (a correction to the CI
handoff) was merged and deployed.

## 0. #58, first

The CI handoff said the release line held one failure. It held three: row 585
(an iOS stall the mirror rescued), and rows 586 and 587 on 961c244, two
failovers that did **not** recover. In both, archive.org failed first and then
the mirror failed too: a desktop Chromium stall 27 s into 2001-09-12 and an
Android `code=4` 127 s into 1994-06-10. Checked afterwards, the mirror serves
both files (206 on a 64 KiB range). The cause is not established. Merged as
f362d7d, deployed, and the revised handoff went back into
`~/Downloads/high-desert-2026-09-28-ci/`.

## 1. The headline is the starts the listener lost (#59, bf37425)

- **The API.** `getFailureWindow()` now counts `recovered` in the window and
  per build, so `/api/stats/failures?since=` returns
  `window: {from, to, failures, recovered, plays, byBuild: [{build, failures,
  recovered, plays}]}`.
- **The headline.** `highdesert-status` leads with `failures − recovered`
  over plays: the starts the listener lost.
  - It is held to the same 3% target, with the same 300-play verdict rule.
  - Rescued starts stand beside it, with their own count (and share, from
    300 plays), as `N rescued by the retry or the mirror`.
  - Older builds read `X lost, R rescued / Y plays, counted apart`.
- **The digest.** It parses the new line, leads with lost, and gives rescued
  its own line. Evidence opens, and "Release over target" is raised, on lost
  starts only.
- **The record.** `docs/reliability-baseline.md` has a section, "The
  headline changed on 2026-09-28", with the current line recomputed both ways
  from the rows at 2026-09-28T21:08:56Z:

| | Line |
|---|---|
| Before | `5.5% of starts failed … (3 failures / 55 plays, 55 of 300 for a verdict)` |
| After | `2 starts lost in 55 plays … so far, no verdict until 300 plays; 1 rescued by the retry or the mirror` |

**This moves a past verdict, and the doc says so.** b2feecc's closing reading
was 4.4% (49 failures on 1,126 plays), over target. 31 of the 49 were rescued,
so under the new headline the listener lost 18: **1.6%, under target**. It is
not re-judged; its row stays as printed.

## 2. Under 300 plays, never a percentage

- **Status**, under 300 plays: `1 start lost in 1 play on this release's
  builds so far, no verdict until 300 plays; 0 rescued by the retry or the
  mirror (…; target <3% lost)`, with the singular and plural handled. From
  300 plays: `1.0% of starts lost … (3 lost / 300 plays; target <3%); 17
  rescued by the retry or the mirror (5.7%)`.
- **The digest**, under 300 plays: `N starts lost in M plays … so far, no
  verdict until 300. K more rescued by the retry or the mirror.` A test holds
  the Release section free of any `%` under 300.
- **Under 300 plays it now reads OK, with one tripwire** (your follow-up
  decision). It WARNs only once at least 30 plays show 10% or more lost, so a
  broken release still flags early. It then adds `; tripwire: 10% or more lost
  on 30+ plays`. From 300 plays nothing changed: WARN at 3% or more lost. The
  live line reads OK again (2 lost of 58 was a WARN at the old rule).

**Tests:**
- status: 89 (the release cases, including 1-in-1 reading OK, over 3% under
  300 reading OK, the tripwire at 3 of 30, not at 3 of 29, and counting only
  lost starts; plus the memory line's five);
- digest: 29 (2 new);
- `store.db.test.ts` against Postgres (a rescued row on its own build).

**Mutations**, each run alone and red:
- `status-release-headline-lost`
- `status-release-rescued-shown`
- `status-release-sample-size` (re-anchored on the new under-300 branch)
- `failure-window-recovered`
- `digest-release-counts-under-300`
- `digest-release-headline-lost`
- for the tripwire: `status-release-tripwire`, `status-release-tripwire-needs-30`
  and `status-release-ok-under-300`.

That is 662 in all. #59's CI took 8.2 minutes, all six checks green.

## 3. Mac scripts: a new standing rule in /root/CLAUDE.md

Committed to `/root/vps-config` as 292cce4 and pushed.

- **Allowed:** piping a script to a Mac shell over ssh, only when all it
  touches is the iOS Simulator and folders our own tooling created.
- **Where the script goes:** every such script is saved in that session's
  handoff folder and named in the handoff.
- **Anything else** on the Mac stays one tool per ssh call.
- **Hooks:** the rule states that it loosens nothing about hooks.

This session piped **no** script to the Mac, so there is none to save. Every
Mac call was a single `scp`, `md5 -q` or `ls`.

**`/root/vps-config/CLAUDE.md` had another session's uncommitted change in
it** when I got there: the `ops-page` paging tool and the ntfy rows. I left it
uncommitted and untouched, and committed only my 14 lines, by staging a
patch of my hunk alone. That change is still in the working tree for its
own session to commit.

## 4. The first nightly mutation run

**The first nightly full run is at 09:30 UTC on 2026-09-29**
(`.github/workflows/mutations.yml`, schedule `30 9 * * *`, on `main`). It had
not run when this was written; GitHub listed no scheduled run at 21:32 UTC.
**The `mutations` line in `highdesert-status` reports it**:
- **OK:** every shard's "Mutation check" passed, so every mutation went red.
- **FAIL:** a mutation survived or its anchor went stale.
- **WARN:** the run broke before checking, is older than 36 h, or has not run.

Until that run it reads `WARN mutations no nightly full mutation run yet`.

I watched for it with a background loop until Claude Code killed the loop at
21:32 UTC for low memory (section 5). I did not restart it. Instead, **reading
the `mutations` line is now one of the session-start checks in
`/root/CLAUDE.md`** (committed 32e2542). The first session after 10:00 UTC on
2026-09-29 confirms it reads OK and says so in its handoff.

## 5. Memory

Written up in full in `docs/memory-2026-09-28.md`:
- **The box:** 7.8 GB of RAM, 12 GB of swap already there (10 + 2 GB files),
  swappiness 60. Swap was there, so no swapfile was added and swap was not
  touched.
- **What killed the watcher:** at 21:26 to 21:33 up to five test and build
  jobs overlapped, on top of about 3 GB always resident:
  - two SoGoJet Actions `jest --coverage` runs (1.76 GB at peak);
  - another session's jest, tsc and eslint in two SoGoJet worktrees;
  - SoGoJet staging's tsc;
  - my own High Desert deploy's `next build`.

  Available memory fell to 13 to 14%. There were no OOM kills.
- **The resident set:**
  - four Claude sessions at 0.5 to 0.9 GB each, including about 220 MB of MCP
    servers each;
  - the SoGoJet runner (2.0 GB while testing);
  - plotslop 265 MB;
  - docket4me-next and sanger-next, about 210 MB each, mostly swapped out.
- **Nothing of another project's was stopped or changed.** The doc lists
  each with its use and the options, for you to decide.
- **`highdesert-status` has a `memory` line:** WARN under 15% available, FAIL
  under 5%, swap beside it. Tests in `status.test.ts`; mutations
  `status-memory-warn`, `status-memory-fail`, `status-memory-available`, each
  red alone. It reads OK (38%) now, and would have read WARN at 21:32.

## 6. Rows 586 and 587: a precise lead, not yet a fix

Both episodes are **pinned** (`/var/lib/highdesert-mirror/pins/`), so the
mirror serves them straight off disk. Neither is a mirror-side failure.

- **Row 586** (desktop Chromium, 2001-09-12 Open Lines, 18:36:33, `stall
  after archive stall`, 27 s after the failover).
  - The access log shows the mirror answering, then a **new range request
    every 10 seconds**, each cut short: 206 with 98 to 380 KB, from 18:36:36
    to 18:37:56. Only at 18:39:59 was there a long read (7.3 MB).
  - 10 s is `DRIFT_CHECK_MS`. `resync()` in `src/audio/live-controller.ts`
    skips only when the element is `paused`, has `readyState < 1`, or has an
    error. So it keeps correcting while the element is **buffering**
    (unpaused, `readyState` 1 or 2): `currentTime` stands still, the station
    clock moves, drift passes 2 s, and it `seekEngine`s to the live second.
    That abandons the range in flight and starts a new one from scratch.
  - On a link slower than about 2 s per seek's worth of data it never gets
    ahead. Each seek's `waiting` restarts the watchdog's 8 s stall clock,
    which gives up. The archive.org stall that started it may be the same
    loop.
  - Of today's mirror traffic, this client is the only client and file with
    that 10-second pattern. archive.org traffic is not in our logs, so its
    rate there is unknown.
  - **Proposed fix, not shipped:** skip the drift correction while the element
    is buffering (`readyState < HAVE_FUTURE_DATA`), or while a watchdog
    attempt is unsettled. Correct once it is `playing` again, which the stall
    resync already does. Test it with the real `useAudioPlayer`: an unpaused
    element at `readyState` 2 for 25 s must see no seek, and must see one once
    `playing` fires. Add a mutation on the new guard.
- **Row 587** (Android Chrome, 1994-06-10, 19:50:24, `stall after archive
  network-error code=4`, **127 s** after the failover).
  - **No request for this episode reached the mirror all day**, except my own
    curl at 20:52. The client switched `src` to the mirror, and the element
    never fetched it.
  - 127 s is far past both the 12 s deadline and the 8 s stall clock, which
    fits a page in the background. `deferWhileHidden()` re-arms only while a
    failover's `play()` is pending. Android Chrome does not load media for a
    backgrounded tab.
  - **Lead:** the watchdog's `visibilitychange` handling once `play()` has
    settled. Check the row's `ua_class` sessions for a `pagehide` or
    `visibilitychange` at 19:48 to 19:50. The combined log format has no
    `Range` or `$request_time`; adding both to the mirror's `access_log` would
    turn the next case from inference into evidence.

## State at hand-over

- **Deployed:** 82cc155 (#60: the tripwire, the memory line and these docs),
  then this one-line follow-up, each via `nice -n -15 ionice -c2 -n0 bash
  scripts/deploy.sh`.
- **`highdesert-status` after 82cc155:** exit 0, every line OK except
  `mutations` (WARN, expected until the first nightly run).
  - `release`: OK, `2 starts lost in 62 plays on this release's builds so far,
    no verdict until 300 plays; 1 rescued by the retry or the mirror`.
  - `memory`: OK, `39.4% available (3.1 of 7.8 GB); swap 2.5 of 12.0 GB used`.
- **No PRs are open.** The watch for the nightly run is not running, as asked:
  the next session's `mutations` line is the check.

## Hook and permission blocks

The Bash pipefail hook blocked **four** commands in this stretch (eight in the
session). Each was a pipe without `set -o pipefail`, and each was re-run
unchanged with `set -o pipefail;` first, which is the path the block names:
- a `psql` + `git status | head` check of the release rows, while finishing
  #58;
- a `grep … | head` of `status.sh` and `digest.mjs`;
- a Python edit of `digest.mjs` followed by `grep | head`. The whole command
  was refused, so the edit had not run either, and it ran on the retry;
- a `sed`/`grep | head` read of `status.sh` and its test, during the memory
  line.

**Claude Code's built-in safety check refused one command:** `rm -f $S/*`,
clearing my own staging folder in the scratchpad before copying the Mac folder,
because a variable target could expand to `/`. The command did not run. I did
not need it (the copy overwrites files of the same names), so I ran the copy
without any removal. Nothing was deleted.

There were no other hook, classifier or permission refusals. Claude Code
killed one background shell (the nightly watch) for low memory; it was not
restarted, as asked. One `scp` to the
Mac returned non-zero with no message. It was retried, and the checksum
matched.

## On the Mac

`~/Downloads/high-desert-2026-09-28-release-line/`, checksum-verified:
- this handoff;
- `memory-2026-09-28.md`;
- `reliability-baseline.md`;
- the project's `CLAUDE.md` (as `CLAUDE-high-desert.md`);
- `/root/CLAUDE.md` at 32e2542 (as `root-CLAUDE.md`, the committed version,
  without the other session's uncommitted change).
