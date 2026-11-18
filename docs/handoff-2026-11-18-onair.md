# Handoff, 2026-11-18 ~01:00 UTC: round 2, the station first on a desktop

Read `docs/NEXT.md` (`## Queue`) with this. Times are UTC.

## Done

- **Triage "high-desert: deploy failing"** was stale: it quoted the daily
  portfolio run of 2026-11-17 08:29 (31 commits undeployed then). Live is
  `d57fe0c`, `highdesert-status` exits 0. Refreshed by re-running
  `SANGER_PORTFOLIO_ONLY=high-desert node scripts/portfolio-checks.mjs` in
  /root/Sanger: the stored `deploy` line now reads OK (00:41), so the triage
  sync closes the item on its next round. **Check it closed.**
- That re-run's tests had **1 failure of 3,297**: `scripts/__tests__/e2e-tokens.test.ts`,
  "every token goes out unchanged in a call", 5 s timeout on a busy box (the
  check is CPU-bound: the chat filter over all 13,824 tokens). Fixed on the
  branch below (30 s for the two exhaustive cases), **not yet on main**. Until
  it is, the portfolio may file "High Desert: Tests failing".
- **sang3r stats:** sang3r already reads `mode=daily` (visitors, views).
  `mode=detail` is wired by sanger-75 on Sanger's side (they confirmed
  00:4x: "Nothing needed from you").
- **The mutation re-run** Jackson approved is set: `hd-requeue-mutations.timer`
  starts `highdesert-mutations` at 03:05 UTC. The weekly timer was never
  missing (enabled, next 2026-11-23 14:00).
- **NEXT.md round 2** written from the 30-day numbers (desktop: 21% saw Live,
  12% tuned in, 7% returned; phones 79/37/23). Date-gated items sit under
  `## Waiting for a date`, which the foreman does not read (it has no date
  gate; the fix belongs in Sanger's `src/lib/foreman/next.ts`).

## In flight: round 2 item 1, branch `desktop-on-air`

Worktree `/root/hd-onair` (node_modules installed), pushed to origin, commits
`c9e9b6e` and `784f705` on top of main `d66a5eb`. Not merged, not deployed.

- `src/lib/live/station-welcome.ts` (the rule, pure), `src/components/library/StationWelcome.tsx`
  (gate + window; reuses `NowPlaying`, `HeroCount`, `useCatalogRow`, now
  exported from `LiveStation.tsx`), placed in `src/app/[look]/(desktop)/library/page.tsx`
  above `ExploreBand`. Section in `docs/funnel.md`, "The station on a
  desktop's first Library".
- Tests pass (15): `src/lib/live/__tests__/station-welcome.test.ts`,
  `src/components/library/__tests__/station-welcome.test.tsx`. Mutations
  `station-welcome-*` (5) all red.
- **Not yet run:** lint, typecheck, the full suite (with the test env), the
  timing of `e2e-tokens.test.ts` with the new timeout, `npm run build` in the
  worktree, `check:csp`/`check:seo` on it, and `e2e/station-welcome.spec.ts`
  (new, never run) against a local build on the e2e database (command in
  `e2e/live.spec.ts`'s header). Then merge to main, `bash scripts/deploy.sh`,
  csp/seo on production, a station notice, tick the item.

## Next

NEXT.md Queue, items 2 to 4 (first order of the Library for a new visitor;
show pages' next show; the Request Line for desktop returns). Waiting for a
date: the mutation re-run's result (after 06:00 today), 2026-11-25,
2026-12-02.

## Notes

- Mac on Jackson's hold (macOS update): handoffs not copied to `~/Downloads`
  since 2026-11-17 night. Copy this one, the night one and NEXT.md once he
  releases it.
- Hook blocks: none. One auto-mode refusal (the transient timer, before
  Jackson's approval); after his Inbox approval it ran.
- Screenshots of production at 1440 (both looks, Library and a show page):
  `/tmp/claude-0/-root-High-Desert/9b00b6fb-54c2-4e83-8460-14df4dc88af4/scratchpad/shots/` (scratch, may be cleared).
- Nothing of mine runs in the background; the queued timing run was stopped.
