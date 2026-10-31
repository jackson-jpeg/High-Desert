# Handoff 2026-10-31: history repeats, archive repeats, Austin M., a dedication

Deployed today at Jackson's request (outside the 08:30 UTC window): web
`4727f44` (`deploy.sh`, returning visitor OK in Chromium and WebKit) and the
chat (`deploy-live.sh`, verified). `check:csp` and `check:seo` against
production: clean.

## Listening History repeated one show (/stats)

Jackson's phone showed "Philadelphia Experiment" six times in one day. Cause:
`(desktop)/layout.tsx` added a history row whenever the player's episode id
changed, and restoring the remembered show on page load is such a change
(none → id), so every visit, reload and update-reload logged it again.

- `recordHistory()` (`src/services/episodes/history.ts`) is now the one
  writer: the newest row is kept when it is the same show on the same local
  day; another show, or a later day, is a new row. Listened seconds keep
  going into the newest row (`flushListenSeconds`, unchanged).
- `HistoryPanel` shows rows through `foldRepeats()`, so the repeats already
  in visitors' IndexedDB stop showing. Nothing stored was deleted (no
  unattended writes to user data).
- Tests: `src/services/episodes/__tests__/history.test.ts` (real Dexie, with
  a control). Mutations `history-no-repeat-same-day`,
  `history-new-day-new-row`, `history-fold-saved-repeats`: all red.

## Archive moments repeated

The journal showed `ghost-to-ghost` posted 31 times in two days, hourly: a
topic match ("ghost") reused a recent moment rather than give way to a fresh
one from a lower rank.

- No rank repeats any of the last 30; with none fresh, the least recently
  used goes. `ARCHIVE_INTERVAL_MS` 60 min → 3 hours.
- Mutations `archive-no-repeat-any-rank`, `archive-every-three-hours` (held
  by a test written in literal hours): red. `docs/live-chat.md` and
  CLAUDE.md updated.

## Supporters

Austin M., $5, at the top of `src/lib/support/supporters.ts`. A station
notice thanked him at 19:50 UTC. The automatic shout-out (next due
2026-11-04) now names him too.

## The dedication

Nervous Bigfoot Hunter (Chicago) wrote at 09:03 UTC that their grandmother
died yesterday; she and their grandpa introduced them to Art Bell in the
90s. A station notice at 19:35 UTC dedicates tonight's 10 PM Pacific show,
Ghost to Ghost 2007, to her. Notices last 12 hours, newest 3, so it is
still on the lines at airtime (no Request Line herald tonight, no shout-out
due).

## Blocks hit

- The pipefail hook refused a pipeline inside `ssh macbook '…'`; I wrote the
  listing to a file and grepped it locally.
- The auto-mode classifier refused a one-shot `systemd-run --on-calendar`
  timer to post a second dedication line at 10 PM Pacific ("Unauthorized
  Persistence"). Not attempted another way. Post it from the admin console
  at airtime if wanted.

## Seen, not changed

- `highdesert-status`: `mutations` FAIL from the 2026-10-26 weekly run,
  `live-heartbeat-route` and `e2e-fixture-view-answered` STALE (anchors
  moved). Next run Monday 2026-11-02.
- `scripts/status.sh` line 173 prints `.deploy/attempt: No such file or
  directory` when no deploy has written that file yet (from `ee2fa6f`).
  Today's deploy wrote one, so it may be quiet now.
- A worktree's full suite needs `npm ci` in `services/live` too, or 13 chat
  test files fail to import `obscenity`.
