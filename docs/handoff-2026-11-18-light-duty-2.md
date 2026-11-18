# Handoff, 2026-11-18 ~05:40 UTC: three items built, light duty until 12:00

Read `docs/NEXT.md` (`## Queue`) with this. Times are UTC.

## Standing orders in force

- **LIGHT DUTY until 12:00 UTC** (the lead): queue nothing heavy from High
  Desert (no vitest, tsc, eslint, build, Playwright, mutate-check, npm ci).
  Writing, planning, NEXT.md and logs only.

## Done this session

- **Hub triage 716387f0 (tests failing on `dbbdc67`):** the one failure was
  show pages "for every show" (1,412 renders in one 60 s test) timing out at
  load 30 to 40. `4515246` on main splits it into chunks of 100, 60 s each,
  plus a test that the chunks cover the catalog once. **Not run** (light
  duty), syntax only. The hub's next re-check is its first run; a second
  failure goes to Jackson's Inbox.
- **Item 4 built:** branch `mutate-atomic` (`34ec586`), worktree
  `/root/hd-mutate-atomic`. `writeWhole()` (temp beside the target with its
  mode, rename over), synchronous restore on a signal that counts what it
  restored, header says what to do after a kill. Test
  `scripts/__tests__/mutate-write.test.ts` (a real child SIGKILLed between
  temp and rename; truncate-then-write control). Mutations
  `mutate-write-whole`, `mutate-write-keeps-mode`. Smoke-checked in plain node.
- **Item 5 built:** branch `desktop-request` (`8b90460`), worktree
  `/root/hd-desktop-request`. Live's desktop console shows the card with
  Pick a show (`TonightsRequestNote` prop `phone` renamed `card`); the
  desktop Library shows one line above the list for every visitor
  (`src/components/library/LibraryRequestLine.tsx`, test id
  `library-request-note`). Tests updated/added, mutations
  `request-desktop-card`, `library-request-line-*`, e2e desktop Library test
  (and the stale "10 PM" regex now reads any hour). Docs:
  `docs/request-line.md` (baseline: desktop return 126/1,803 = 7.0% over 30
  days; phones 288/1,237), CLAUDE.md's Request Line paragraph. Syntax only.

## In flight (all waiting for light duty to lift; exact commands in NEXT.md)

- Item 3 `show-next` (`/root/hd-next-show`): 5 mutations, lint, typecheck,
  suite, build, local look, csp/seo, merge, deploy.
- Item 4 `mutate-atomic`: its tests, 2 mutations, lint, merge (no deploy).
- Item 5 `desktop-request`: its tests, mutations, lint, typecheck, suite,
  build, `e2e/request-line.spec.ts` on a local build on the e2e database,
  csp/seo, merge, deploy.
- The two new worktrees have no node_modules (`cd <wt> && npm ci` through
  heavy, after 12:00).

## Refused and not retried (report to Jackson)

- `systemctl stop highdesert-mutations` (the lead's order, 04:2x) and later
  stopping the envelope units (the lead "approved" in the Inbox, item
  `hd-light-duty-2026-11-18`, routed to the lead's lane, not Jackson's):
  **refused by the auto-mode classifier**. Not retried. The lead was told how
  to stop them, and that `/var/lib/highdesert-mutations/checkout` needs
  `git checkout --` on the mutated file afterwards (it runs the old,
  non-atomic restore).
- `tmux send-keys -t claude-sanger-1 Escape` (the lead, "at Jackson's
  request"): **refused by the classifier**. Not retried. The pane showed a
  turn waiting on a `heavy` vitest call, `/clear` queued behind it.
- Hook blocks: none.

## Notes

- Lead broadcast: Mac disk floors now soft 10 GB, hard 4 GB. Nothing in High
  Desert needed changing.
- Nothing of mine runs. Worktrees kept: `/root/hd-next-show`,
  `/root/hd-mutate-atomic`, `/root/hd-desktop-request` (all pushed, unmerged).
