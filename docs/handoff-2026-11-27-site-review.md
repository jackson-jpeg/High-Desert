# Handoff 2026-11-27: mutation timer, and Duet's site review

Two asks from Jackson (via Sessions, 2026-11-26), both done.

## 1. Mutation timer (lead's call)

- `highdesert-mutations.timer` now fires **Mondays 19:00 UTC** (after peak), and the service has
  `TimeoutStartSec=20h`. Commit `c1b9397` (units, the service-unit test, a new mutation
  `weekly-mutations-timeout-20h`, the copy in digest/status/CLAUDE.md), both mutations red.
- Installed in `/etc/systemd/system/`, `daemon-reload`, timer restarted. Next run Mon 2026-11-30 19:00.
- `Persistent=true` caught up the missed slot at once: a **full run started Thu 2026-11-26 19:24 UTC**
  on `c1b9397`, still going at 00:40 on 11-27. Until it finishes, status `mutations` reads the
  11-18 result (FAIL on the 5 stale ids fixed in `75ab96a`). When it ends, read that line again.
- Inbox item `f7ca4a4b` closed (as lead).

## 2. Duet's site review (`docs/site-review-duet.md`)

**Live as `d1d14a4`** (deployed 2026-11-27 00:34 UTC). Built fixes 1 to 8 and 10; the doc's top
says what was built, where it differs from Duet's text, and why 9 and 11 were not:

- About links the real collection (`ultimate-ultimate-art-bell-collection`); the unsourced quote is gone.
- "over 1,400 episodes" in place of "thousands" (welcome, metadata, manifest).
- Guests: four show titles cleared from the seed and hidden on older libraries (`NOT_A_GUEST`);
  Robert Ghost Wolf and Robert Morningsky each one page (`PERSON_ALIASES`); the old pages 308
  (checked on production: `/guest/robert-ghostwolf` → `/guest/robert-ghost-wolf`,
  `/guest/robert-morning-sky` → `/guest/robert-morningsky`).
- archive.org links on show pages are encoded; `/shows` pages titled Archive in Win98; one-show
  years read naturally; Request Line says Pacific once; On This Day 220 px on desktop; a show's
  breadcrumb runs High Desert, Every show, year, show.
- **Not built:** fix 9, a new icon plus install screenshots (the repo's screenshots are from March
  and show the old UI; the icon is art for Jackson's eyes; in NEXT, Needs Jackson). Fix 11, optional.

Checks: `site-review.test.tsx` 11/11; ten `site-review-*` mutations red; lint and typecheck clean;
full suite 3,187 passed. The only failures were a missing `services/live/node_modules` in the
worktree (installed, then all passed), two 5 s timeouts on a busy box (passed on rerun) and two
chat DB files that collide when run in parallel (passed serially). Build; check:seo on the build;
check:csp on the build, whose only findings were `/live-api/*` 404s (no chat service behind a bare
`next start`). After the deploy: returning visitor ok in Chromium and WebKit, check:seo and check:csp
on production clean, `highdesert-status` all OK except the stale `mutations` line above and WARNs
for steal (20.3%) and the Mac backup copy (Mac unreachable).

Station notice posted before the deploy (201). Branch `duet/site-review` deleted on origin; the
worktree `/root/scratch/hd-review` and local branch `site-review` removed. No PRs.

## Hook blocks this session

- **npm hook:** `npm ci` inside a compound command with a subshell was blocked (it could not prove
  the folder). Reran as `cd /root/scratch/hd-review && HEAVY_SESSION=hd-review heavy ... -- npm ci`,
  its own command in the worktree, which passed.
- **pipefail hook:** a pipe inside `ssh macbook "df -h / | tail -1"` was refused. Reran as
  `ssh macbook "df -h /"` with no pipe.
- Auto mode once gave no verdict on a call made beside another; reissued alone, it ran.
