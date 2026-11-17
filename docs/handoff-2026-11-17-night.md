# Handoff, 2026-11-17 night (UTC): the Tonight 500, fixed and live

Read `docs/NEXT.md` (`## Queue`) with this. Times are UTC.

## Done

- **Live: `d57fe0c`, deployed 23:03** with `deploy.sh`. Client check and the
  returning visitor (Chromium and WebKit) passed. check:seo (49 pages) and
  check:csp (8 routes) pass on production. `highdesert-status` exits 0; one
  WARN, `mutations` (weekly run skipped this week). Station notice posted
  23:12.
- **`68e7565`, the Tonight 500.** `src/services/live/manifest.ts` fetches the
  mirror manifest with `next: { revalidate: 60 }` instead of
  `cache: "no-store"`, so a Tonight page (ISR) that is first to freeze a day
  stays static. Test `src/services/live/__tests__/manifest-fetch.test.ts`
  (red before the fix), mutation `live-manifest-fetch-static-safe` (red).
  Proven on a local build on the e2e database: today's row cleared,
  `/tonight/2026-11-17` froze it and answered 200.
- **`d57fe0c`, a rollback's cause.** The first deploy of `68e7565` rolled
  back on one WebKit page error, `/api/live/time due to access control
  checks`: the clock sync cut off by the check's own navigation (caught in
  `syncClock`). `NAVIGATION_NOISE` in `scripts/returning-visitor.mjs` now
  names that route and nothing else under `/api/live`. Test red without it;
  mutations `returning-noise-clock-sync`, `returning-noise-not-every-live-route`
  red.
- Suite on the fix: 3,029 passed; the 13 files that failed at import
  (`services/live` not installed in the worktree) passed after its `npm ci`
  (290 tests).

## In flight

Nothing. Worktree `/root/hd-tonight` and its branches removed; my local
server on :3013 stopped. (`/root/hd-audio` is not mine.)

## Next

Only date-gated items are left in NEXT.md:
1. Not before 2026-11-25: `playsBySurface.show` above 0 in
   `/api/stats/usage?days=7`, and `/shows/*` indexed in Search Console.
2. Not before 2026-12-02: read the phone look split (`docs/funnel.md`),
   write the verdict, remove `LOOK_SPLIT_SCRIPT`.

## Notes

- **Mac hold** (Jackson, ~22:50, macOS update): no ssh to the Mac until he
  releases it. This handoff and NEXT.md are not yet copied to `~/Downloads`;
  copy both once he does.
- No hook blocks. Auto mode twice gave no verdict on a command the pipefail
  hook rewrote; re-issued verbatim as told, both ran.
- The e2e database's 2026-11-17 `live_days` row was cleared and re-frozen by
  the build (test data only).
