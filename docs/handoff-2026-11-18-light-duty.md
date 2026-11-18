# Handoff, 2026-11-18 ~04:15 UTC: item 2 live, item 3 built, light duty

Read `docs/NEXT.md` (`## Queue`) with this. Times are UTC.

## Standing orders in force

- **LIGHT DUTY** (line lead, ~04:05): no heavy jobs, builds, suites or
  renders until the lead lifts it. Writing, planning, NEXT.md, logs only.
- One heavy job at a time when it lifts.

## Done this session

- **Triage 716387f0 (tests failing):** `622d97a`, status and backup script
  tests get 30 s per test (load timeouts). The hub closes it on its re-check.
- **Round 2 item 2 live as `34e1085`** (03:28): a new desktop visitor's
  Library opens on Most played. All checks, both browsers' returning visitor,
  check:seo/csp on production; notice 03:32; ticked (`d18fea3`). Screenshots
  in `Assets/2026-11-18-library-first-order/`.
- Envelope run waiting since 02:18 stopped on the lead's word; the timer
  queued one fresh run at once (03:21:52).

## In flight: item 3, branch `show-next`

Worktree `/root/hd-next-show` (node_modules installed, `services/live` not),
pushed, clean, rebased on this handoff. Not merged, not deployed.

- `src/lib/shows/next.ts` (`nextShow`: same guest's next appearance, else
  their earliest; else the page's first topic, nearest after, else before),
  `src/components/shows/ShowNextPlay.tsx` (Play next in the page's own
  player, inside the tap; `SHOW_SWITCH_EVENT`), `ShowPlayButton` follows the
  switch (counts the next show, drops the moment), `NextCard` in `ShowView`
  (a link without JavaScript; the Play hidden by `NO_SCRIPT_PLAY_CSS`).
  Doc: `docs/show-pages.md`, "The next show". 8 mutations in
  `scripts/mutate-check.mjs`.
- **Passed:** `next.test.ts`, `show-next-play.test.tsx`, `show-page.test.tsx`,
  `show-page-listen.test.tsx` (31 tests). Mutations red: `next-show-guest-first`,
  `next-show-guest-after`, `next-show-topic-after`.
- **Left:** `node scripts/mutate-check.mjs next-play show-play-follows show-next`
  (5), lint, typecheck, suite (with the test env), build; on a local build on
  the e2e database (recipe in `e2e/live.spec.ts`'s header, port 3013): open a
  show page at 1440 and 390, press Play next (sources swap, a play posts for
  the next key; keep it out of counts), check:csp/seo; merge, deploy,
  csp/seo on production, notice, tick, FYI line.

## Found

- **`mutate-check.mjs` can leave a mutated file EMPTY when killed** (now a
  Queue item with the fix). After any interrupted run: `git status` in that
  tree and `git checkout --` the targets.

## Notes

- Hook blocks: none. Auto-mode "no verdict" once (a call in the same response
  changed by the pipefail hook); re-issued alone, ran.
- Claude Code reaped my background jobs for low memory twice (local server,
  screenshot, mutation run); requeued only on the lead's word.
- My `pkill -f` killed its own shell (02:5x); the server was then stopped by
  PID after checking its cwd. Use PIDs only.
- Nothing of mine runs. Port 3013 free. Mac on hold for handoff copies.
