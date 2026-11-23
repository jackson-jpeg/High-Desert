# Handoff, 2026-11-22 ~07:20 UTC: supporter tiers deployed; the ship branch rebased and built

Read `docs/NEXT.md` with this. The earlier handoff of the day is
`docs/handoff-2026-11-22-ship.md`. Times are UTC. Stopped at 80% context, on
the foreman's word.

## Current state, 2026-11-23 05:0x UTC, re-read after the twenty-fifth context call (read this first)

- **Done:** everything in the Queue; nothing in flight, no worktrees, no
  servers, tree clean and pushed.
- **Next:** after today's 14:00 UTC weekly mutation run
  (`highdesert-mutations.timer`), read `highdesert-status`'s `mutations`
  line. Expected OK (the 6 stale ones were re-anchored in `75ab96a`), which
  closes triage c8fce546. A survivor becomes a Queue item.
- **Then:** the date-gated lines in NEXT.md (2026-11-25, 2026-12-02).
- The foreman's "context over 90%" calls arrive minutes after each /clear
  with the context nearly empty; the reading looks wrong (filed by sanger
  03:54). Nothing here needs it.

## Done

1. **Supporter tiers** (Jackson, 01:41 ET), `f5d8467` on main, deployed
   (see "Deploy" below for the result):
   - `src/lib/support/supporters.ts`: `{ name, gifts: number[] }`, `TIERS`
     (owner 50, night-owl 15, regular 10, caller 0), `totalOf`, `tierOf`,
     `groupByTier` (empty tiers dropped, list order kept), `tierLine()`.
   - `Supporters.tsx`: a section per tier (`data-tier`, an h3 with the tier
     name, `ul aria-label=<tier>`), "Name $total" items, and the tier line
     under the links (`data-testid="supporter-tier-line"`).
   - `donor-shoutout.mjs`: parses `gifts`, and `--status` gives
     `{name, amount (the total), gifts, tier}`, so sang3r's
     `SupportersTab.tsx` still reads `amount`. Station Owners get their own
     sentence first ("A special thank you to our Station Owner: Joseph K.");
     with only owners there is one sentence, so nobody is named twice. The
     script's copy of `TIERS` is held equal to the page's by a test.
   - Checks: own tests 21/21; mutations `supporters-*` 8/8 red and
     `shoutout-*` 10/10 red (ten of them new); lint on the changed files;
     typecheck; `npm run build`. `--now --dry-run` reads well and posted
     nothing.
   - CLAUDE.md's Supporters note and `docs/admin-console.md` updated.
2. **The ship branch** `ship-2026-11-22` (`/root/hd-1122`) is rebased on main,
   with its docs commit dropped and no conflict, and pushed as `b924f3a`.
   `npm run build` there passed (`/root/scratch/hd-1122/build.log`).

## Deploy (tiers)

`bash scripts/deploy.sh`, log `/root/scratch/hd-tiers/deploy.log`. The
outcome is in the update at the bottom of this file. Once it is live: read
/stats on production in both looks at 390 and 1440 (the tiers panel, no em
dash), run check:csp on production, and post a station notice.

## Next (in order)

1. If the tiers deploy rolled back, read its log first.
2. Ship branch: `git rebase origin/main` in `/root/hd-1122` (it now sits
   under the tiers commits; no overlap expected), then `npm run build` again.
   Run `e2e/request-line.spec.ts` (the only e2e spec the branch touches) on a
   local build on the e2e database: commands in `e2e/live.spec.ts`'s header,
   port 3013 (free at 07:15; check with `ss -ltnp`). Then check:seo and
   check:csp on that build, then a look at a show page's Next by hand. Then
   fast-forward main, push, `deploy.sh`, check:seo and check:csp on
   production, and a station notice.
3. Tick the three ship items and the presence item in NEXT.md, then run
   `highdesert-status` (presence should read OK).
4. Cleanup: `git worktree remove /root/hd-tiers` (merged) and
   `/root/hd-1122` after its merge; remove `/root/scratch/hd-tiers` and
   `/root/scratch/hd-1122`.

## Hook blocks this session

- The built-in safety check refused a Bash heredoc that wrote
  `supporters.ts`, reporting a removal it could not rule out (the command
  deleted nothing). I wrote the same content with the Write tool. That is a
  file write, not a removal.
- Heavy: the mutation run (a "mutation" label, so the low lane) waited about
  20 minutes behind the low-lane envelope job, as designed.

## Needs Jackson

Nothing.

## Update: the tiers deploy result

- **Live as `dacac34`.** Client check passed; returning visitor ok in
  Chromium (Library 1.5 s, Stats 2.8 s) and WebKit. `/api/build` reads
  `dacac34-ef429e8`: the suffix is the dirty-tree hash, because this handoff
  file sat untracked in `/root/High-Desert` during the deploy. It is a doc
  only, so the build is the committed code. The next deploy clears it.
- Read back: production's /stats chunk holds the `TIERS` table ("Station
  Owner", min 50, ...). **Still to do (next session):** a rendered look at
  /stats in both looks at 390 and 1440, and check:csp on production. No
  station notice was posted, because the chat was not touched.
- The tiers item is ticked in NEXT.md.

## Update, 07:30: the ship branch live as `57c4a95`

- Rebased `ship-2026-11-22` on main, built, ran `e2e/request-line.spec.ts`
  on a local stack (app 3013, chat 3015, proxy 3014, e2e database): 9 passed,
  11 skipped by the spec's project filters. check:seo and check:csp clean on
  that build. Fast-forwarded main, pushed, `deploy.sh`: clean, returning
  visitor ok in both browsers. check:seo and check:csp clean on production;
  a show page's Next read back from production. Station notice posted.
- Tiers leftovers done: /stats's supporters panel rendered on production at
  390 and 1440 in both looks (screenshots were in `/root/scratch/hd-1122/shots`,
  deleted with the scratch folder; nothing wrong in them), check:csp clean.
- `highdesert-status`: presence OK; the only FAIL is the known `mutations`
  line, which clears after Mon 2026-11-23 14:00 UTC.
- Hook blocks: the auto-mode classifier refused `git push --force-with-lease`
  of the rebased ship branch. Not retried; main was fast-forwarded instead, so
  `origin/ship-2026-11-22` holds the pre-rebase commits and can be deleted.
- Queue empty; the rest waits for 2026-11-25 and 2026-12-02.
- Cleanup: worktrees `/root/hd-tiers` and `/root/hd-1122` removed, scratch
  folders removed, local stack stopped (own PIDs).

## Correction, 07:40: the tiers deploy log, and verification closed

- `/root/scratch/hd-tiers/deploy.log` no longer exists: I deleted it with
  the scratch folder in the 07:30 cleanup, before it was asked for. Its
  outcome is still on record elsewhere. `.deploy/history` has
  `dacac34 2026-11-22T07:07:34Z` (deploy.sh appends there only after a
  verified deploy), and the next deploy's returning-visitor check upgraded
  from `dacac34-ef429e8` in both browsers, so dacac34 was live and had not
  rolled back. What the log itself said beyond that is lost.
- Tiers verification is complete: rendered on production at 390 and 1440 in
  Win98 and Night (four tiers, Station Owner first, tier line under the
  links, no overflow, no em dash) and check:csp on production clean (9
  routes). NEXT.md's tiers line now says so.

## Holding, 2026-11-23 03:3x UTC (written for the foreman's context clear)

- **Done:** everything above. Main is `5ae3b45` plus this note, and the
  live build is `57c4a95`. Nothing is in flight: no worktrees, no servers,
  no heavy jobs, no scratch.
- **The hold:** the lead, 02:0x UTC. Jackson's weekly usage is at 88% and
  resets Thu 2026-11-26 11:00 UTC. No new work and no self-checks until the
  lead says the hold is over; fix only errors that break something live.
- **Next, after the hold:** `docs/NEXT.md`. Its Queue is empty. The dated
  items are 2026-11-25 (show plays and Search Console's `/shows/*`) and
  2026-12-02 (the phone look split verdict, then apply it).
- **Known FAIL:** `highdesert-status` `mutations` (six stale anchors,
  re-anchored in 75ab96a). It should clear after the weekly run of Mon
  2026-11-23 14:00 UTC (a timer, not this session). If it still fails
  after that run, that is the first thing to look at.
- The foreman's "Next release: 0000AN /api/analytics" line belongs to
  sang3r.com's NEXT, not this repo's.

## Still holding, 2026-11-23 (after the foreman's continue)

- The foreman sent "continue" after the clear; the Queue is empty and the
  lead's hold still stands (it lifts only on the lead's word, usage resets
  Thu 2026-11-26 11:00 UTC). Nothing done, nothing in flight, no files
  changed but this note and NEXT.md's log.
- Hook block: the pipefail hook refused `ssh macbook "df -h / | tail -1"`
  (pipe inside a remote command); reran without the pipe.
- Next: unchanged from "Holding" above. First look after 14:00 UTC today:
  `highdesert-status`'s `mutations` line.

## Still holding, 2026-11-23 03:4x (the foreman's context call)

- Done: nothing. The Queue is empty and the lead's usage hold stands (it
  lifts on the lead's word; usage resets Thu 2026-11-26 11:00 UTC).
- In flight: nothing; no worktrees, no background shells, no scratch.
- Next: after 14:00 UTC today, `highdesert-status`'s `mutations` line (the
  weekly run should clear triage c8fce546). Once the hold lifts, the
  2026-11-25 item under "Waiting for a date" in `docs/NEXT.md`.
- The foreman's "Next release: /api/analytics" line is sang3r.com's item
  (claude-sanger-1), not this repo's.
- No hook blocks this session.

## Still holding, 2026-11-23 03:5x (the foreman's second context call)

- Done: nothing. Read NEXT.md and this handoff after the foreman's continue;
  the Queue is empty and the lead's usage hold stands (lifts on the lead's
  word; usage resets Thu 2026-11-26 11:00 UTC).
- In flight: nothing; no worktrees, no background shells, no scratch.
- Next: after 14:00 UTC today, `highdesert-status`'s `mutations` line (the
  weekly run should clear triage c8fce546; if it still FAILs, look there
  first). Once the hold lifts, the 2026-11-25 item under "Waiting for a
  date" in `docs/NEXT.md`.
- No hook blocks this session.

## Still holding, 2026-11-23 04:0x (the foreman's third context call)

- Done: nothing new. In flight: nothing (no worktrees, servers, heavy jobs,
  scratch). Main `20a9396` plus this note; live build `57c4a95`.
- Next: unchanged from "Holding" above. The lead's usage hold stands until
  the lead lifts it (usage resets Thu 2026-11-26 11:00 UTC). After 14:00 UTC
  today, read `highdesert-status`'s `mutations` line; it should clear with
  the weekly run. Then the dated items in `docs/NEXT.md` (2026-11-25 first).
- No hook blocks this session.

## Still holding, 2026-11-23 03:4x (the foreman's fourth context call)

- Done: nothing. In flight: nothing (no worktree, server or heavy job).
- Next: unchanged. The lead's usage hold stands until the lead lifts it;
  then `docs/NEXT.md` (Queue empty; 2026-11-25 and 2026-12-02 items under
  "Waiting for a date"). The weekly mutation run, Mon 2026-11-23 14:00 UTC,
  should turn `highdesert-status`'s `mutations` line OK and close triage
  c8fce546.

## Still holding, 2026-11-23 03:5x (the foreman's fifth context call)

- Done: nothing. In flight: nothing (no worktree, server, heavy job or scratch).
- Next: unchanged. The lead's usage hold stands until the lead lifts it
  (usage resets Thu 2026-11-26 11:00 UTC). After the weekly mutation run
  (Mon 2026-11-23 14:00 UTC), `highdesert-status`'s `mutations` line should
  read OK and close triage c8fce546; if not, look there first. Then
  `docs/NEXT.md` (Queue empty; 2026-11-25 and 2026-12-02 dated items).
- For the lead: this context call came minutes after a fresh `/clear`, so
  the 90% reading may be stale. Five clear/continue/context rounds since
  03:3x have each produced only a handoff note.
- No hook blocks this session.

## Still holding, 2026-11-23 03:5x (the foreman's sixth context call)

- Done: nothing. In flight: nothing (no worktree, server, heavy job or scratch).
- Next: unchanged from the fifth note above. The lead's usage hold stands
  (usage resets Thu 2026-11-26 11:00 UTC). After the weekly mutation run
  (Mon 2026-11-23 14:00 UTC), read `highdesert-status`'s `mutations` line;
  it still shows the 2026-11-18 run, and the six stale ones were re-anchored
  in 75ab96a. Then `docs/NEXT.md` (Queue empty; dated items 2026-11-25, 2026-12-02).
- For the lead: the context reading is stale; this session was cleared
  minutes ago and has used very little. Six clear/continue/context rounds
  since 03:3x have produced only handoff notes.
- No hook blocks this session.

## Still holding, 2026-11-23 (the foreman's seventh context call)

- Done: nothing. In flight: nothing (no worktree, server, heavy job or scratch).
- Next: unchanged from the sixth note. The lead's usage hold stands (usage
  resets Thu 2026-11-26 11:00 UTC). After the weekly mutation run (Mon
  2026-11-23 14:00 UTC), read `highdesert-status`'s `mutations` line first.
  Then `docs/NEXT.md` (Queue empty; dated items 2026-11-25, 2026-12-02).
- For the lead: the context reading is stale (this session was cleared
  minutes ago and used two small reads). Seven rounds now; each round's
  handoff commit is the only work it produces. Consider holding the
  context call for this session until the hold lifts.
- No hook blocks this session.

## Still holding, 2026-11-23 (the foreman's eighth context call)

- Done: nothing. In flight: nothing (no worktree, server, heavy job or scratch).
- Next: unchanged from the seventh note. The lead's usage hold stands (usage
  resets Thu 2026-11-26 11:00 UTC). After the weekly mutation run (Mon
  2026-11-23 14:00 UTC), read `highdesert-status`'s `mutations` line first.
  Then `docs/NEXT.md` (Queue empty; dated items 2026-11-25, 2026-12-02).
- For the lead: the context reading is stale (two small reads since the last
  clear). Eight rounds now, each producing only this note.
- Block hit: the pipefail hook refused `ssh macbook "df -h / | tail -1"`
  (pipe inside the remote command); reran without the pipe.

## Still holding, 2026-11-23 04:0x (the foreman's ninth context call)

- Done: nothing. In flight: nothing (no worktree, server, heavy job or scratch).
- Next: unchanged. The lead's usage hold stands (usage resets Thu
  2026-11-26 11:00 UTC). After the weekly mutation run (Mon 2026-11-23
  14:00 UTC), read `highdesert-status`'s `mutations` line first. Then
  `docs/NEXT.md` (Queue empty; dated items 2026-11-25, 2026-12-02).
- For the lead: the context reading is stale again (one small read since the
  last clear). The foreman's "Next release" line (Sanger notification-tap
  crash) is sang3r.com's NEXT, not this repo's.

## Still holding, 2026-11-23 (the foreman's tenth context call)

- Done: nothing. In flight: nothing (no worktree, server, heavy job or scratch).
- Next: unchanged. The lead's usage hold stands (usage resets Thu
  2026-11-26 11:00 UTC). After the weekly mutation run (Mon 2026-11-23
  14:00 UTC), read `highdesert-status`'s `mutations` line first. Then
  `docs/NEXT.md` (Queue empty; dated items 2026-11-25, 2026-12-02).
- For the lead: the foreman's "over 90%" reading is stale (this context holds
  two reads and two short replies). Each continue/context pair produces only
  this note and a commit; this note is written only so the 30-minute
  no-handoff rule does not file an Inbox item for Jackson.
- No hook blocked this session.

## Still holding, 2026-11-23 04:1x (the foreman's eleventh context call)

- Done: nothing. In flight: nothing (no worktree, server, heavy job or scratch).
- Next: unchanged. The lead's usage hold stands (usage resets Thu
  2026-11-26 11:00 UTC). After the weekly mutation run (Mon 2026-11-23
  14:00 UTC), read `highdesert-status`'s `mutations` line first. Then
  `docs/NEXT.md` (Queue empty; dated items 2026-11-25, 2026-12-02).
- For the lead: the "over 90%" reading is stale (this context holds two reads
  since the last clear). Eleven rounds, each producing only this note.
- No hook blocked this session.

## Still holding, 2026-11-23 04:2x (the foreman's twelfth context call)

- Done: nothing. In flight: nothing (no worktree, server, heavy job or scratch).
- Next: unchanged. The lead's usage hold stands (usage resets Thu
  2026-11-26 11:00 UTC). After the weekly mutation run (Mon 2026-11-23
  14:00 UTC), read `highdesert-status`'s `mutations` line first. Then
  `docs/NEXT.md` (Queue empty; dated items 2026-11-25, 2026-12-02).
- For the lead: the "over 90%" reading is stale (this context holds two reads
  since the last clear). Twelve rounds, each producing only this note.
- No hook blocked this session.

## Still holding, 2026-11-23 04:1x (the foreman's thirteenth context call)

- Done: nothing. In flight: nothing. Next: unchanged (after Mon 14:00 UTC,
  `highdesert-status`'s `mutations` line; then NEXT.md's dated items).
- The loop's cause is already in the Inbox (sanger, 03:54: the foreman reads
  Opus 5.5's context as 106K), so no new item. No hook blocked this session.
- 04:1x, the foreman's fourteenth context call (right after the thirteenth):
  same state. Done nothing, in flight nothing, next unchanged. This context
  holds only a few small reads, so the "over 90%" is the misreading already
  in the Inbox (sanger, 03:54).
- 04:2x, the fifteenth context call (after a continue that found nothing to
  do): same state. Done nothing, in flight nothing, next unchanged. The
  "over 90%" is the misreading already in the Inbox (sanger, 03:54).

## Still holding, 2026-11-23 04:3x (the foreman's sixteenth context call)

- Done: nothing. In flight: nothing. The Queue is empty and the lead's usage
  hold stands (lifts on the lead's word). The context call came right after
  a /clear, with the context nearly empty, so the 90% reading looks wrong
  (the loop's cause was filed by sanger at 03:54).
- Next: after 14:00 UTC, check that `highdesert-status` `mutations` reads OK
  (closes triage c8fce546); then the dated items in `docs/NEXT.md`.

## Still holding, 2026-11-23 04:3x (the foreman's seventeenth context call)

- Done: nothing. In flight: nothing. The Queue is empty; the lead's usage
  hold stands. The context call came right after a /clear, so the guard
  is reading a stale figure (loop already filed by sanger, 03:54).
- Next: unchanged. After 14:00 UTC, read `highdesert-status`'s `mutations`
  line (should close triage c8fce546); then the dated items in NEXT.md.

## Still holding, 2026-11-23 04:4x (eighteenth context call)

- Done: nothing new. In flight: nothing (no worktrees, servers, heavy jobs,
  scratch). Next: `docs/NEXT.md` once the lead lifts the hold; dated items
  2026-11-25 and 2026-12-02. Known FAIL: `mutations`, expected to clear
  after today's 14:00 UTC weekly run; if not, look there first.
- The foreman's "over 90%" call came right after a /clear with almost no
  context used; the reading looks wrong (same loop sanger filed 03:54).
- No hook blocks this round.

## Still holding, 2026-11-23 04:5x (nineteenth context call)

- Done: read NEXT.md and status after the /clear; Queue empty, nothing to
  do. In flight: nothing (no worktrees, servers, heavy jobs, scratch).
- Status at 04:36: deploy OK (live `57c4a95`, nothing to deploy),
  returning OK; `mutations` FAIL is the 2026-11-18 run, already fixed in
  `75ab96a`; read it again after today's 14:00 UTC weekly run (closes
  triage c8fce546). Then the dated items (2026-11-25, 2026-12-02).
- Again called "over 90%" a few minutes after a /clear; the reading looks
  wrong (the loop sanger filed 03:54). No hook blocks.

## Still holding, 2026-11-23 05:0x (the foreman's twentieth context call)

- Done: read NEXT.md and ran `highdesert-status`. Every line is OK except
  `mutations`, which is the 2026-11-18 run. It was fixed in 75ab96a and gets
  re-read after today's weekly run at 14:00 UTC (closes triage c8fce546).
- In flight: nothing. No worktree, no server, no heavy job.
- Next: the Queue is empty. The dated items start 2026-11-25. The foreman's
  "next release" line (the Sanger Remote crash) belongs to claude-sanger-1,
  not to this repo.
- This context call again came right after a `/clear`, with the context
  nearly empty (the loop sanger filed at 03:54).
