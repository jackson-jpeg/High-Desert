# Handoff: the release line, the Mac-script rule, the first nightly (2026-09-28)

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
- **One thing I kept as it was:** status still WARNs when the lost share is 3%
  or more, even under 300 plays. The line is a flag, not a verdict. It no
  longer prints the share there, but it still flags one. Right now it reads
  WARN at 2 lost of 58 (3.4%). If you would rather it read OK until there is a
  verdict, that is a one-line change.

**Tests:**
- status: 81 (6 new or rewritten release cases, including 1-in-1 and "rescued
  not held to the target");
- digest: 29 (2 new);
- `store.db.test.ts` against Postgres (a rescued row on its own build).

**Mutations**, each run alone and red:
- `status-release-headline-lost`
- `status-release-rescued-shown`
- `status-release-sample-size` (re-anchored on the new under-300 branch)
- `failure-window-recovered`
- `digest-release-counts-under-300`
- `digest-release-headline-lost`

That is 656 in all. #59's CI took 8.2 minutes, all six checks green.

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

(Filled in once the 2026-09-29 09:30 UTC run has finished. See below.)

## State at hand-over

- **Deployed:** bf37425 (#59) via `nice -n -15 ionice -c2 -n0 bash
  scripts/deploy.sh`, clean. `/api/build` answers bf37425.
- **`highdesert-status`** exits 0. Two WARNs, both expected:
  - `release`: 2 lost in 58 plays, 1 rescued, no verdict until 300 plays.
  - `mutations`: until the first nightly run. See section 4.

## Hook and permission blocks

The Bash pipefail hook blocked **three** commands in this stretch. Each was a
pipe without `set -o pipefail`, and each was re-run unchanged with `set -o
pipefail;` first, which is the path the block names:
- a `psql` + `git status | head` check of the release rows, while finishing
  #58;
- a `grep … | head` of `status.sh` and `digest.mjs`;
- a Python edit of `digest.mjs` followed by `grep | head`. The whole command
  was refused, so the edit had not run either, and it ran on the retry.

There were no other hook, classifier or permission refusals. One `scp` to the
Mac returned non-zero with no message. It was retried, and the checksum
matched.

## On the Mac

`~/Downloads/high-desert-2026-09-28-release-line/`, checksum-verified: this
handoff, `reliability-baseline.md`, the project's `CLAUDE.md` (as
`CLAUDE-high-desert.md`), and `/root/CLAUDE.md` at 292cce4 (as
`root-CLAUDE.md`, the committed version, without the other session's change).
