# Handoff, 2026-11-17 ~18:30 UTC: the listener queue

Read `docs/NEXT.md` (`## Queue`) with this. Times are UTC.

## Standing changes today (Jackson)

- **No deploy window any more.** Deploy with `bash scripts/deploy.sh` as soon
  as a change's checks pass, any hour (memory `deploy-window`, updated).
- **Skip the weekly mutation run this week.** It was stopped at the lead's
  request, and the status `mutations` line may WARN until the next Monday run
  (14:00 UTC). Do not start it by hand.
- The Level envelope batch runs again (timer `highdesert-level-envelopes`,
  restarted 18:00). 116 envelopes were stored when it was paused.
- No re-queue timers exist (`hd-requeue-*` were deleted).

## Done

- **Deployed `9474f79` at 15:22** (Jackson approved in the Inbox): Level,
  Next.js 16.4.6, the shorter Sim Sunday spot, the pull of 1998-03-05.
  Status exits 0, and `check:seo` and `check:csp` pass on production. The
  Level station notice is posted, and the result is in the Inbox (item
  `hd-deploy-result-2026-11-17`).
- `docs/NEXT.md` now has a `## Queue` of the five biggest listener
  improvements, chosen from the 30-day usage numbers.

## In flight: Queue item 1, show pages count their plays

- Worktree **`/root/hd-showplays`**, branch **`show-page-plays`**, commit
  `f5463d4`, pushed. `npm ci` is done in the worktree. The new test and
  `src/components/shows` pass (3 files, 20 tests, 18:12). Not run yet:
  mutations, lint, typecheck, the full suite, build.
- What it does: `src/services/stats/show-page-listen.ts`
  (`installShowListen`) is installed by `ShowPlayButton` on the page's
  `<audio>`. It sends one `/api/stats/play` per page load on the first
  `playing` (surface `show`, source from `currentSrc`, build, look), and a
  heartbeat with the show every minute while playing, none under
  `hd-not-counted`. `ShowView` passes `episodeId={key}`.
- It adds a test `src/services/stats/__tests__/show-page-listen.test.tsx`,
  four mutations `show-listen-*` in `scripts/mutate-check.mjs`, and a "Counting
  a listen" section in `docs/show-pages.md`.
- **Next steps:**
  1. (Done: the focused tests pass.)
  2. `node scripts/mutate-check.mjs show-listen`.
  3. Lint, typecheck, then the full suite with the test DB env.
  4. `npm run build`, then `check:csp` and `check:seo` against the build.
  5. Merge to main, pull in `/root/High-Desert`, `bash scripts/deploy.sh`,
     `check:seo`/`check:csp` on production, then tick the item.
  6. Remove the worktree.
- Watch for: the play route's allowlist takes the community key (`key` in
  ShowView); and a checker that presses play on a show page would now write a
  play (`csp-check` does not press play).

## Next

Queue items 2 to 5 in `docs/NEXT.md`: typo-tolerant archive search, a
crawlable `/shows` archive for Google, the phone tune-in rate on Live, and
one-tap resume with the position shown.

## Hook blocks this session

None since the deploy (the earlier ones are in `NEXT.md`).

## Worktrees

`/root/hd-showplays` (in flight, pushed) and `/root/hd-audio` (Clean up,
kept).
