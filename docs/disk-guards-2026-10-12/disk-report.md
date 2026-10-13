# VPS disk report, 2026-10-12

One page: the disk before and after, what used the space, what grows back, and
what Sim Sunday and Bambu use (report only, nothing of theirs touched).

## Before and after

| | Free on `/` | Used |
|---|---|---|
| Before (2026-10-12, start of session) | **2.9 GB** | 98% |
| After the cleanup | **21.4 GB** | 78% |
| At the time of writing (2026-10-13 00:04 UTC) | **23.5 GB** of 103 GB | 78% |

About **18.6 GB** was removed. Every item is logged with its size in this
session's cleanup log; the groups:

| What | Size | Notes |
|---|---|---|
| Build caches | 4.9 GB | `~/.gradle/caches` 2.1G, PlotTwists-Native `build/` 971M, Docket4Me `.turbo` 906M, wallowa builds 471M, braille-course-web `.next` 269M, `~/.m2` 204M. All rebuildable |
| SoGoJet test records | 4.5 GB | 63 `.xcresult` bundles and attachment folders in `/root/test-records/sogojet-redesign/` from runs no doc cites. Every run's `.log` and `.summary` were kept |
| Vitest temp dirs | 2.9 GB | 2,548 dirs in `/tmp`, one per test run, never deleted by Vitest (all projects' runs) |
| Git worktrees, merged or abandoned, clean | 2.2 GB | hd-ci, hd-deps, hd-deps-1011, hd-stats-split, LeftSaid-rebrand, ScreenReceipts-render, sogojet-redesign-merge. Each checked: no uncommitted work, every commit on a remote |
| Old Claude Code session temp | 2.2 GB | four sessions idle over a day, held by nothing (a SoGoJet affiliate session 1.6G, three High Desert ones) |
| Docker leftovers | 1.2 GB | `/var/lib/containerd`, `/var/lib/docker`; Docker was retired on 2026-09-24 |
| Small | 0.7 GB | apt cache 366M, runner installer tarball 216M (2.337.0 already unpacked), rotated logs over 14 days 51M, 42 High Desert test temp dirs 21M |

Not touched: databases, DB backups, the mirror's pinned shows (15 GB),
`.env` files, any running service's files, Sim Sunday, Bambu.

## Kept, for you to decide

- **Worktrees with work in them:** `LeftSaid-crash` (uncommitted changes),
  `LeftSaid-site` (5 commits not on any remote), `sogojet-affiliate` and
  `sogojet-redesign` (uncommitted changes), and SoGoJet's locked agent worktree
  `.claude/worktrees/agent-a1fcac8e15e693b76` (52M; removing it was refused by the
  permission check, so it stays).
- **Large, maybe old:** `/root/restore` (1.9 GB, the July migration tarball).
- **Shared caches, which slow every project down when emptied:** `~/.npm` 1.8G,
  `~/.cache/ms-playwright` 1.6G (two Chromium versions), `~/.local/share/claude`
  1.2G, `~/.claude/projects` 1.3G (session transcripts), the Actions runner's
  `.npm` 911M, `~/.cache/pip` 601M, `/tmp/node-compile-cache` 223M.
- **atop history** (760M, 14 days): kept on purpose, it is the only per-process
  CPU record.

## What grows back, and what now handles it

| Grows back | Rate seen | Handled by |
|---|---|---|
| Vitest temp dirs | ~1.5 GB a week | High Desert's runs now remove their own (`vitest-tmp.global.ts`); `disk-sweep` removes any project's after 24 h |
| Claude Code session temp | GBs per long session | `tmp-sweep` (weekly, after 3 days idle) |
| Test output (`test-results`, `playwright-report`, `coverage`, `.turbo`, `.next-staging`, `.next-dev`) | per run | `disk-sweep`, untracked and over 7 days old |
| Stale worktrees | a few a week | `disk-sweep`: idle 14 days, clean, all commits on a remote. The rule in `/root/CLAUDE.md`: agents remove their own at session end |
| apt cache, journal, rotated logs | slow | `disk-sweep`: `apt-get clean`, journal to 14 days, logs over 30 days |
| SoGoJet `.xcresult` records, `~/.gradle`, `~/.m2`, PlotTwists `build/` | per build | **not automated**: they belong to their projects' build tools. Worth a retention rule in SoGoJet's test tooling |

`disk-sweep.timer` runs Sundays 16:40 UTC (Nice 19, idle IO, 10% CPU) and logs
to `/var/log/disk-sweep.log`. `highdesert-status` has a `disk` line: WARN under
15 GB free, FAIL under 5 GB.

## The mirror's 328

The warm job last ran on 2026-10-12 at 04:18 UTC and **stopped at its floor**
with 5.9 GB free (it keeps 10 GB free), 324 pinned of 328. The disk now has room
for the rest. The next run is 04:10 UTC on 2026-10-13. It skips itself while
hypervisor steal is above 20%, and steal is at 60-70% under Hostinger's CPU cap
(see the handoff), so it may skip. `highdesert-status`'s `warm` line says which.

## Sim Sunday and Bambu (report only)

| | Where | Size |
|---|---|---|
| Sim Sunday | `/root/simsunday` | 104M |
| | `/opt/simsunday` (with `simsunday.service`) | 289M |
| | Claude Code session temp (two sessions) | 3.0G |
| | **Total** | **about 3.4 GB** |
| Bambu | `/root/.venv-cad` | 1.7G |
| | `/root/bambu-mcp` | 13M |
| | Claude Code temp (`/tmp/claude-0/-root-bambu-mcp`, one session) | 67M + 124M |
| | **Total** | **about 1.9 GB** |

Neither has a database in Postgres. Both sweeps (`disk-sweep`, `tmp-sweep`)
skip anything whose path, or whose Claude Code session transcript, names
either project.
