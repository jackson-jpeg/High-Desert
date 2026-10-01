# Handoff, 2026-10-01: Call in on iPhone, quiet Report, show titles, /tmp sweep

Branch `session/2026-10-01`, PR #64. vps-tools `8919db7`, vps-config `663cb00`.
Folder on the Mac: `~/Downloads/high-desert-2026-10-01-callin/`.

## Start of session

- `repo-bundle-status`: OK (2026-09-30 17:15). `sogojet-deploy-status`: OK.
- `highdesert-status`: all OK except two WARNs: `warm` (pins below target:
  stopped at the disk floor, 6.5 GB free) and the Mac copy of the DB backup
  (the Mac's disk).
- **`mutations` reads OK**: the nightly full run on 2b4ba86
  (2026-09-30T16:02Z), every mutation red in all 4 shards.

## 1. Call in went off the top of the screen after Listen live

The caller's screenshot (`IMG_3624.jpg` in this folder) and their words:
"After I click listen live and can hear the show the call in button goes too
far north that it's off the screen." Another iPhone caller saw it fine.

**Reproduced** in WebKit at 390 wide against production, every write blocked
(stats, heartbeat, `/live-api/tuned`):

| Case | Call in before | after Listen live |
|---|---|---|
| toolbar up (390 x 664) | y 140 to 184 | **y 8 to 52** |
| toolbar down (390 x 750) | 140 to 184 | 8 to 52 |
| 47 px top inset | 140 to 184 | 8 to 52, 39 px of it under the status bar |
| column scrolled 60 px | 80 to 124 | 8 to 52 |

On a phone, Listen live and Call in are both `order-first`. Tuning in unmounts
the card, and Call in becomes the top of the column, 132 px higher.
`viewportFit` is `cover`, but `<main>` did not pad the top safe-area inset on
phones (only the radio, the full-screen player and the toaster did). Safari
reports no top inset in portrait. An in-app browser (WKWebView, as in Reddit)
or Chrome on iOS can draw the page under the status bar and report one, which
puts the button under it. That fits "fine for one iPhone, not another". WebKit
has no scroll anchoring either, so a scrolled column moved it further.

**Fix:** `<main>` pads `--safe-top` on phones (`md:pt-0`; RadioDial's own
padding removed so it is not doubled), and Call in is `sticky top-0` in the
Live column.

**Test:** `e2e/live-qa.spec.ts`, "after Listen live, Call in and the call box
stay on screen". It sets a 47 px `--safe-top` (Playwright cannot set `env()`),
then at 664 and 750 checks, after Listen live, that Call in sits below the
inset and on screen, again with the column scrolled to its end, and that the
call box in the sheet does too. **Run against production (the build before
this), it fails**: "Call in after Listen live at 664", `ok: false`. CI runs it
against this branch's build.

What a Playwright inset cannot prove is that a real WKWebView reports the
inset this way. **Worth asking the caller (ArtBellFan1976) to check once this
is live.**

## 2. Report

It was a full 44 px button under every call. Now it is a small word beside
the time (`ReportLink`), with the 44 px target supplied by a centred `::after`
that adds nothing to the layout. Unit test in `live-chat.test.tsx`; mutation
`live-chat-report-target`.

## 3. On Air showed "Art-Bell_Midnight_In_the_Desert--2015-12-08_--_Ar…"

Screenshot `IMG_3622.jpg`. That string is the community key of the
2015-12-08 Midnight in the Desert show, added in the 2026-09-28 community
import. **Root cause:** `SEED_VERSION` was still `2026-07-27-a`, and
`reconcileLibrary()` runs once per version, so **nobody seeded before
2026-09-28 has received any of those 101 shows.** On Air looked the id up in
the visitor's library, found nothing, and printed `title || fileName || id`.

- `SEED_VERSION` is `2026-10-01-a`. `src/db/__tests__/seed-version.test.ts`
  records the catalog's set of shows (count and digest) against the version
  and fails when one changes without the other.
- `/api/stats/now` sends `title` (from the catalog) with each `onAir` and
  `recent` entry.
- `episodeTitle()` and `keyTitle()` (`src/lib/library/display-title.ts`) never
  return a file name or a key. The 40 places that spelled
  `title || fileName` now call them: On Air, recently played, the leaderboard,
  failures, the station, the library, stats, the player, the palette and the
  rest. The digest and export read the server catalog, which uses the same
  function. `display-title.test.ts` fails on any `title || fileName` (or
  `title ?? id`) spelled anywhere else in `src/`. `dedupKey` is exempt: it is
  identity, and changing it would change what counts as a duplicate.

**Guest fields that repeat the title.** 136 rows removed from the seed, each
logged with its original value in `docs/catalog-guests.md`. The rule is: not a
person, and the same words as the title's subject. People whose name is the
title (281 rows) keep their guest. Older libraries keep the old fields (reconcile
never rewrites a row), so surfaces read the guest through `shownGuest()`.
**Ten more guest fields** describe the programme without repeating the title
(e.g. 2001-08-31 "Area 51, Earthquakes, and Crop Circles"). They are listed in
the doc **for your decision** and left alone.

## 4. /tmp sweep, then the warm job

`tmp-sweep.timer` in vps-tools: weekly (Sunday 16:20 UTC), Nice 19, idle IO,
CPUQuota 10%. It deletes a `/tmp` entry, or one Claude Code session directory,
only if nothing in it changed in 3 days, no process holds any of it (fds,
cwd, root, mapped files, bound sockets), and it holds no socket, FIFO, device
or mount. It never touches systemd-private, snap, tmux or X11 dirs. Each
deletion is logged with its size in `/var/log/tmp-sweep.log`. Two-way tests:
`tests/tmp-sweep.test.sh`, 19 cases.

First run, today:
- It was too slow: it re-read all of `/proc` per unit under the 10% quota. I
  stopped it after 12 minutes. Its deletions (1,572 units, 1.7 GB) are logged
  from the dry run's list. Now it refreshes the open set at most every 5 s and
  writes each log line as it happens.
- The rerun took 24 s and freed another 246 MB. In total about 1.95 GB was
  freed (old Next.js build dirs, SoGoJet feed snapshots, Claude scratch), with
  nothing held open and no errors.

**The warm job rerun still stopped at the floor**: 329 pinned (16.0 GB), 44 of
the top 373 missing, 7.4 GB free against a 10 GB floor. Most of `/tmp` is
newer than 3 days (Claude Code session dirs alone are 4 GB), so the sweep
cannot close the gap by itself. Where the rest of the disk goes is under
"Disk", below.

### Disk: where the rest goes (for your decision; nothing deleted)

Measured 2026-10-01 03:20Z, `du -xs`, largest first, after the sweep:

| Size | Path | Note |
|---|---|---|
| 16.8 G | `/var/lib` | mostly the mirror's pins (16.0 G) and Postgres; the mirror is the point |
| 6.6 G | `/root/.npm` | npm's download cache; `npm cache clean --force` regenerates on demand |
| 5.6 G | `/root/test-records` | unknown owner |
| 2.6 G | `/opt/actions-runner-sogojet` | SoGoJet's runner |
| 2.5 G | `/root/Docket4Me` | |
| 2.2 G | `/root/.gradle` | Gradle cache |
| 2.2 G | `/root/.cache` | tool caches (Playwright browsers among them) |
| 1.8 G | `/root/restore` | leftover from a restore? |
| 1.7 G | `/root/.venv-cad` | |
| 0.9 G | `/root/hd-live-qa` | an old High Desert checkout |
| 0.7 G | `/root/sogojet-redesign-merge` | a SoGoJet worktree |

The warm floor needs about 2.6 GB more free space, plus room for the 44
missing episodes. The npm cache alone covers that. Clearing it, or anything
else in this table, is your call.

## 5. Release verdict

Recorded in `docs/reliability-baseline.md`: 02db307's line is **under target,
1.9% of starts lost on 321 plays** (your reading at the 300-play mark).
Status this morning: 1.6%, 9 lost in 557 plays, 2.4 of 7 days in.

## Hooks hit this session

`require-pipefail.py` blocked **five** commands, all mine and all correct
blocks: pipelines without `set -o pipefail` (two into `head`, one inside an
`ssh` remote command, two greps). Each was rerun with `set -o pipefail;` in
front, or without the pipe. No other hook blocked anything.

## Deploy

See "Deploy record" at the end, written after CI and the deploy.
