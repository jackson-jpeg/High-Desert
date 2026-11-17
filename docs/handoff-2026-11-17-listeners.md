# Handoff, 2026-11-17 ~18:55 UTC: the listener queue (second session)

Read `docs/NEXT.md` (`## Queue`) with this. Times are UTC.

## Standing changes today (Jackson)

- **No deploy window.** Deploy with `bash scripts/deploy.sh` as soon as a
  change's checks pass, any hour.
- **Skip the weekly mutation run this week.** Do not start it by hand.
- **Envelopes (Inbox answer, 18:5x):** "Start the envelope timer right after
  the fuzzy-search ship lands. No need to ask." So once the deploy is done:
  `systemctl start highdesert-level-envelopes.timer`, and tick that NEXT.md
  item.

## In flight: branch `fuzzy-search`, worktree `/root/hd-fuzzy`

Not pushed, not merged. It holds items 1, 2, 3 and 5 of the listener queue
(`b035df5` show-page plays, `e4883e1` fuzzy search, `1992a96` `/shows`,
`09b542c` resume "of"). This session added three test-only commits:

| Commit | What |
|---|---|
| `bfc0bee` | `fuzzy-search.test.ts`: every show naming the intended word is found ("hogland" is also one edit from another word). Matcher unchanged |
| `223d5c2` | `show-page-listen.test.tsx`: the post helpers keep `body`'s type (typecheck failed) |
| `3953393` | `/shows` and `/shows/[year]` added to the sitemap count (`seo-page.test.ts`, now also checks each year URL), `event-routes.test.ts`'s route list, and the link resolvers of `request-line-page.test.tsx` and `tonight.test.tsx` |

### Results so far

- Focused run (library, shows, show-page-listen): **37 files, 345 passed**.
- Lint: **passed** (6 warnings, all in files this branch does not touch).
- Typecheck: **passed** after `223d5c2`.
- Full suite (before `3953393`): 11 failed tests + 13 suites that could not load.
  - The 11 tests: 10 were `/shows` missing from the tests (fixed in `3953393`), plus
    `status.test.ts` › geoip "FAILs past 75 days", a 5 s timeout on a busy box.
    Watch it in the next full run.
  - The 13 suites: `services/live/test/*` (12, `obscenity` not installed: the
    worktree never had `services/live`'s own `npm ci`) and
    `scripts/__tests__/e2e-tokens.test.ts` (0 tests, cause not read yet).

**Running when this was written** (background, will die with the session):
`cd services/live && npm ci`, then a vitest rerun of exactly the failed files.
If the session is cleared, re-run in `/root/hd-fuzzy`:

```bash
cd /root/hd-fuzzy/services/live && heavy --label hd-fuzzy-live-ci -- npm ci --no-audit --no-fund
cd /root/hd-fuzzy && set -a && . /root/.high-desert-test.env && set +a
heavy --label hd-fuzzy-refail -- npx vitest run services/live scripts/__tests__/e2e-tokens.test.ts scripts/__tests__/seo-page.test.ts src/lib/__tests__/event-routes.test.ts src/components/request-line src/lib/tonight
```

If e2e-tokens still loads nothing, read its error (it may need a Playwright
or `e2e/` import the worktree lacks; main's suite passed it on 11-17 morning).

### Then, in order

1. `npm run test` (full suite) and `npm run build`. Logs went to this
   session's scratchpad; any place is fine.
2. Mutations, **after** the build: `for m in show-listen library-search-fuzzy
   shows-archive library-filter-text continue-resume; do node
   scripts/mutate-check.mjs $m; done` (clean tree). They run in heavy's
   **low lane**, which waits while any normal job waits; the envelope batch
   queues a normal job per show, so they may sit a long time. See "Blocks".
3. `check:csp` and `check:seo` against the build.
4. From `/root/High-Desert`: `git merge fuzzy-search` (main has only docs
   commits since: `76ca45b`, `da88e49`, and this handoff; take main's
   `docs/NEXT.md`), push, `bash scripts/deploy.sh`, then `check:seo` and
   `check:csp` against production.
5. Start the envelope timer (Jackson's answer above). Tick the ship and
   envelope items in NEXT.md. Remove `/root/hd-fuzzy` and `/root/hd-showplays`.

## The envelope batch

`highdesert-level-envelopes.service` started at 18:00 and is still going
(the timer is stopped, next run "-"). It takes High Desert's one heavy slot per
show (5 to 10 min each), so every check here alternates with it. The
`hd-requeue-*` timers in NEXT.md's 18:00 log entry do not exist.

## Blocks this session

- **Permission refusal:** `systemctl stop highdesert-level-envelopes.service`
  (to stop the batch starving the low-lane mutations). Not retried. I
  reordered my own chain instead (mutations after the build). If the
  mutations cannot get the slot, ask Jackson in the Inbox whether to pause
  the batch until the deploy.

## Item 4: approved, queued

Jackson approved in the Inbox: "Run the 50/50 split for 2 weeks on new phone
visitors only." Queued in NEXT.md after the ship, with the design notes
(phones without an `hd_look` cookie and no prior visit only; crawlers stay
Win98; read the result 2 weeks after it ships). Not started.

## Worktrees

- `/root/hd-fuzzy` (in flight, unpushed; now has `services/live/node_modules`).
- `/root/hd-showplays` (merged into the above; remove after the merge).
- `/root/hd-audio` (Clean up, kept).
