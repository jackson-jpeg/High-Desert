# Handoff, 2026-11-17 ~18:35 UTC: the listener queue

Read `docs/NEXT.md` (`## Queue`) with this. Times are UTC.

## Standing changes today (Jackson)

- **No deploy window.** Deploy with `bash scripts/deploy.sh` as soon as a
  change's checks pass, any hour.
- **Skip the weekly mutation run this week** (the status `mutations` line
  WARNs until next Monday, 14:00). Do not start it by hand.
- The Level envelope batch runs hourly (`highdesert-level-envelopes`). Each
  show holds High Desert's heavy slot for 5 to 10 minutes, so every check
  here waits behind it.

## In flight: one branch, four items

All of the work is on branch **`fuzzy-search`**, worktree **`/root/hd-fuzzy`**.
It has a real `npm ci`. It is **not pushed and not merged**. Item 1's branch
`show-page-plays` is merged into it, so that branch's rebased commit ships
through this one. The force-push of that rebase was refused, and I did not
retry it.

| Item | Commit | What |
|---|---|---|
| 1 Show pages count their plays | `b035df5` | `src/services/stats/show-page-listen.ts`, installed by `ShowPlayButton` |
| 2 Search forgives spelling | `e4883e1` | `src/lib/library/fuzzy-search.ts`, used only when nothing matches exactly; `SpellingNote`; `docs/library-search.md` |
| 3 `/shows` archive | `1992a96` | `src/lib/shows/archive.ts`, `src/components/shows/ShowsArchive.tsx`, `src/app/[look]/shows/`; links in `ShowShell` and the welcome page; sitemap; `check:seo` |
| 5 Continue listening "of" | `09b542c` | `resumeLabel()`; the restored player shows `startPositionFor()` |
| docs | (last commit) | NEXT.md |

New mutations: `show-listen-*`, `library-search-fuzzy-*`, `shows-archive-*`,
`continue-resume-of-length`. The free-text block of `filter-episodes.test.ts`
now also asserts that each match is exact, or `library-filter-text-tags`
would survive through the fallback.

**The check chain was running in the background when this was written**
(started about 18:22). `npm ci` passed. The focused run failed once (below). Its logs are in the old session's
scratchpad, which may be gone. **Re-run the steps that have no result**, in
`/root/hd-fuzzy`:

```bash
cd /root/hd-fuzzy && set -a && . /root/.high-desert-test.env && set +a
heavy --label hd-fuzzy-focus -- npx vitest run src/lib/library src/components/shows src/components/library src/services/stats/__tests__/show-page-listen.test.tsx
for m in show-listen library-search-fuzzy shows-archive library-filter-text continue-resume; do node scripts/mutate-check.mjs $m; done
npm run lint && npm run typecheck && npm run test && npm run build
```

Then `check:csp` and `check:seo` against the build. Next, from
`/root/High-Desert`: `git merge --ff-only fuzzy-search` (or merge it), push,
`bash scripts/deploy.sh`, then `check:seo` and `check:csp` against
production. Tick the items in NEXT.md, then remove `/root/hd-fuzzy` and
`/root/hd-showplays`.

**Focused tests ran: one failure.** `fuzzy-search.test.ts` › "Hogland finds
shows": not every result mentions Hoagland. "hogland" is also one edit from
another word (likely "holland"), and the test asserts every result carries
the corrected word. Fix: assert that the results include the Hoagland shows
and that the suggestion is "hoagland" (the most carried). Do not loosen the
matcher. Everything else in the focused run passed. Then re-run from the
mutations onward (the chain stops being useful after this).

Not yet seen by any test run:
- `shows-archive.test.tsx` has never run either.
- The restored player's readout fix in `src/app/[look]/(desktop)/layout.tsx`
  has no test. Mounting the layout was not worth it for one line.

## Item 4: with Jackson

On phones, Live → tune-in was 44% in Win98 (414 of 935) and 79% in Night
(167 of 212) over 30 days. Night users chose that look themselves, so the
comparison is not clean. Inbox item **`hd-phone-look-test`** asks to split
new phones 50/50 between the looks for 2 weeks. His answer will be typed
into the session. Approve: build the split (the funnel already records the
look). Decline: look for a change inside the Win98 Live screen instead.

## Hook blocks this session

- A permission refusal of `git push --force-with-lease` (the rebased
  `show-page-plays` branch). Not retried; that branch ships through the
  merge.
- Calling `bash scripts/heavy.sh --label …` failed: the project wrapper does
  not take `--label`. Nothing ran. I used `heavy --label …` directly.

## Worktrees

- `/root/hd-fuzzy` (in flight, unpushed, holds all the work).
- `/root/hd-showplays` (merged into the above; remove after the merge).
- `/root/hd-audio` (Clean up, kept).
