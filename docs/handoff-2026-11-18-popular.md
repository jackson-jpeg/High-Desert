# Handoff, 2026-11-18 ~01:35 UTC: round 2 item 1 live, item 2 built

Read `docs/NEXT.md` (`## Queue`) with this. Times are UTC.

## Done

- **Round 2 item 1 (desktop, the station first) is live as `107fd60`**
  (deployed ~01:15; the returning visitor ok in Chromium and WebKit).
  Checks before merge: lint (warnings only), typecheck, the full suite
  (3,045 passed; the 13 import failures were `services/live` uninstalled in
  the worktree and passed after its `npm ci`, 290 tests, `e2e-tokens` inside
  its new 30 s), `npm run build`, `e2e/station-welcome.spec.ts` 4/4 at 1440
  in both looks on a local build on the e2e database, check:seo (no
  findings) and check:csp (no violations; only `/live-api` 404s, which a bare
  `next start` lacks) on that build. After the deploy, check:seo and
  check:csp pass on production. Station notice posted 01:18. Worktree
  `/root/hd-onair` and branch `desktop-on-air` removed (merged).
- NEXT.md ticked and logged (`c771c05`).

## In flight: round 2 item 2, branch `popular-first`

Worktree `/root/hd-popular` (node_modules installed, `services/live` too),
commit `169938e` pushed to origin, on top of `107fd60`. Not merged, not
deployed.

- `src/lib/library/first-sort.ts` (the rule, pure): no stored sort, no
  listening history (`progress` or `history` rows), desktop (min-width
  768 px) → `played` (Most played · everyone). Applied in
  `useLibraryFilters` after mount, **not stored**; a sort the visitor picks is
  remembered as before. Phones untouched (look split until 2026-12-02).
- Tests: `src/lib/library/__tests__/first-sort.test.ts`, and new cases in
  `src/hooks/library/__tests__/sort-persistence.test.tsx` (stubs
  `matchMedia`; the persistence cases now seed a progress row so they stay
  about the stored sort). Mutations `first-sort-*` (6) in
  `scripts/mutate-check.mjs`. Doc: `docs/funnel.md`, "The Library's first
  order", with the baseline (30 d: 2,101 library plays / 3,016 first visits;
  7 d: 611 / 613).
- **Not yet run:** those two test files (a run was queued behind the envelope
  job when the context filled; re-run them), the mutations
  (`node scripts/mutate-check.mjs first-sort`), lint, typecheck, the full
  suite with the test env, `npm run build`, then on a local build on the e2e
  database: a look at /library at 1440 in both looks for a fresh profile
  (the Sort bar now shows above the list, under the station window; check
  that the first rows are still on the first screen) and the library e2e
  specs (`library-rail`, `library-intents`, `library-phone`) for any that
  assumed newest first on a fresh profile. Then check:csp/seo on the build,
  merge, `bash scripts/deploy.sh`, csp/seo on production, station notice,
  tick the item.

## Next

NEXT.md Queue, items 3 and 4 (show pages' next show; the Request Line for
desktop returns). Waiting for a date: the mutation re-run's result (03:05
start; read after 06:00), 2026-11-25, 2026-12-02.

## Notes

- Hook blocks: none. One auto-mode "no verdict" because the pipefail hook
  rewrote a command (an `npm ci` with a pipe); re-issued with
  `set -o pipefail;` already in it, and it ran.
- Mac on Jackson's hold: handoffs not copied to `~/Downloads` since
  2026-11-17 night. Copy this one, the onair one, the night one and NEXT.md
  once he releases it.
- Nothing of mine runs in the background except the queued vitest run of
  item 2's two test files (harmless if it finishes or is killed). My local
  `next start` on 3013 was stopped.
