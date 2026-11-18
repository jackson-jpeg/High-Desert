# Handoff, 2026-11-18 ~02:35 UTC: item 2 checked up to the screenshots; stopped for memory

Read `docs/NEXT.md` (`## Queue`) with this. Times are UTC.

## Done this session

- **Triage 716387f0 (tests failing on `20f70f2`)**: the hub's only failure
  was `e2e-tokens` past 5 s, already fixed in `107fd60`. Under load (12 to
  53) `status.test.ts` and `backup-db.test.ts` timed out too; both now get
  30 s per test. `622d97a` on main (tests and docs, nothing to deploy). The
  hub re-checks HEAD on idle.
- **Round 2 item 2, branch `popular-first`** (worktree `/root/hd-popular`,
  rebased on `622d97a`, now `3609ed8`, pushed): passed
  - the two new test files (14/14), the 6 `first-sort-*` mutations (all red),
    lint (warnings only), typecheck;
  - the full suite: 3,314 passed, 7 failed, every one a timeout in files the
    branch does not touch (the two above, show pages, topic pages), on a box
    at load 12 to 53; reruns failed different tests each time, the two
    status/backup files pass 138/138 with 30 s;
  - `npm run build`;
  - on a local build on the e2e database (port 3013): `library-rail`,
    `library-intents`, `library-phone`, `station-welcome`, 44 passed, 10
    skipped (project-specific cases), in desktop and mobile.

## Stopped

At 02:30 Claude Code killed my local `next start` (3013) and the screenshot
script for low system memory (15 GB used of 16, 1 GB available, nothing of
mine running now). Not restarted on purpose.

## Left for item 2

1. When memory allows: `next start` on the e2e database again (recipe in
   `e2e/live.spec.ts`'s header), the look at 1440 in both looks for a fresh
   profile (list opens on Most played, first rows on the first screen under
   the station window), saved under the project's Assets; then
   `check:csp` and `check:seo` against it.
2. Merge `popular-first` fast-forward, `bash scripts/deploy.sh`, check:seo
   and check:csp on production, station notice, tick the item, one FYI line.

## Notes

- Hook blocks: none. One auto-mode "no verdict" (a call changed by the
  pipefail hook in the same response); re-issued alone and it ran.
- "Project Assets" (the lead's instruction): High Desert has no `Assets/`
  folder yet. The screenshots were to go in `Assets/2026-11-18-library-first-order/`
  on the branch.
- Mac still on hold for handoff copies (see the popular handoff).
