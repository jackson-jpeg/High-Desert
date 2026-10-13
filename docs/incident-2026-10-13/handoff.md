# High Desert: the Library and Stats hang, the rollback, and the station notice (2026-10-13)

## What happened

- **About 04:35 UTC.** Jackson saw the Library stuck on gray loading rows and Stats stuck on "Loading station data", in both looks, on Android Chrome as a returning visitor. The Live bar kept working.
- **Not the server.** The VM had been up since 2026-09-24, so no stop/start happened. `highdesert`, `highdesert-live`, Postgres and nginx were all active. Every API answered in under 50 ms, including `/api/stats/now`, `/api/stats/community`, `/api/live/schedule` and `/seed/library.json`. The access log showed no failure pattern; the only 404s were one iPhone tab requesting a two-builds-old page's chunks.
- **What hung.** Both screens wait on two reads from the browser's own database (IndexedDB): episodes and history. Neither ever answered. Live doesn't use that database, which is why it kept working.
- **The suspect cleared.** The "0 episodes" change (PR #76) changes only the status bar's label. The Library's gray rows show only while the episodes read is unanswered, or while it is empty and the seed hasn't settled. A returning visitor has rows, so it does not depend on that signal.
- **Not reproduced.** A returning-visitor profile on today's build loaded on both the first and the second visit (Chromium, Pixel 7).
- **Best guess, unproven:** another tab or the installed app held the database. Android freezes background tabs, and a frozen tab holding a write transaction blocks reads everywhere else. It cleared on its own.

## The rollback, and my mistake

At 04:39:46 I rolled production back to 7712a6b (before PR #76). I misjudged the clock: it was about 2 minutes into the incident, not the 10 allowed. I also went back further than the evidence supported. For about a minute that put the old chat look in front of callers during the busy hour. Jackson then reported the site working, and main (415867e) was redeployed at 04:40:55.

## The station notice (Jackson asked for an apology in the chat, styled like the archive cards)

- **New feature, commit 44bbbfb on main.** `POST /live-api/admin/notice {text}` (admin only, 1 to 500 characters) sends a `station` event.
  - The page draws it in the archive card's place, headed **From the station** (Notepad: `>>> From the station`), with no show link.
  - hello carries the newest 3 for 12 h, in memory only. It is never stored as a call.
  - It has its own event name, so a page from before the release ignores it instead of heading it "From the archive".
- **Tests:** `moderation.db.test.mjs` covers:
  - admin only (401);
  - 400 for empty or too long;
  - its own event;
  - included in hello;
  - not stored as a call.

  `live-chat.test.tsx` covers the event and hello, the heading, and a control. `notepad-phone-lines.test.tsx` covers the heading. Three mutations went red: `live-station-notice-*`.
- **Deployed:**
  - web: `deploy.sh`, 44bbbfb;
  - chat: `deploy-live.sh`, which verified health, an SSE hello through nginx and a POST round trip.

  Callers' streams reconnected once.
- **Posted at 04:52:24 UTC** (365 characters, no em dash):
  > Sorry for the hiccups tonight. For a few minutes some of you saw the Library and Stats stuck loading, and the chat briefly went back to its old look. Everything is back to normal now. Miss the old dark look? In Win98, tap Start > Settings > Display, pick Night, then OK. To come back: More > Display on a phone, or View > Display on a desktop. Thanks for listening.
- Checked on production on a phone in both looks (`screens/notice-*.png`).
- To post another: the admin token is in `/root/.high-desert-live.env`. Send `curl -X POST https://highdesert.space/live-api/admin/notice` with `Content-Type: application/json`, `Origin: https://highdesert.space`, `Authorization: Bearer <token>` and `{"text": "..."}`.
- A notice lasts until the chat service restarts.

## archive.org (asked at 04:42)

archive.org is up. The site probe says up, and `/download` served three ranged reads in 1.0 to 1.5 s from `dn720703.ca.archive.org`. The mirror badge came from the show on the air, 2001-09-11. It is a repaired show and always plays from the mirror (22 of 23 live mirror plays). The other mirror plays were failovers: 13 in 6 hours, all rescued.

## Two caller asks, shipped (Dogman, 04:53 to 05:10 UTC)

- **Place and line in italics, both looks.** Commit efd24f4: Night's `caller-meta` span, Win98's `.hd-w98-notepad-meta`.
- **A place replaces the line.** Commit a254174. `shownLine()` in `src/lib/live/chat-rows.ts` drops the line when the caller gave a place. It applies in Night, the Notepad, the Notepad's copied text and the phone's preview. A caller with no place still shows their line.
- **Checks:**
  - tests both ways in each look, with the name held upright;
  - mutations `live-caller-meta-italic`, `win98-notepad-meta-italic` and `lines-place-replaces-line` went red;
  - `win98-notepad-call-line` re-anchored to the new code, also red;
  - the branch's changed set went red;
  - deployed, then checked on production in both looks (`screens/line-*.png`).

## The watch on the chat (04:52 to 10:52 UTC)

Calls were read straight from Postgres, never as a listener. The watch ran until 10:52 UTC. In six hours there were two calls, both from Dogman:

- 04:53 "Cool! Thank you" (a direct reply to the notice). He then asked for the place and line in italics, and for the line to go when there is a place; both shipped above.
- 05:05 "OJ?" (about the show).

Nothing came in after 05:05: the room was quiet through the morning hours (UTC). No complaints, no reports, nothing hidden.

## The nightly mutation failure (17:18 UTC run, fixed the same day)

- **What failed.** Shard 4/4: `failover-hidden-stall-waits` survived. It deletes the stall clock's "wait while the page is hidden" line, and the 05:02:09 test still passed.
- **Why.** Since 441cea1 ("why 62"), a failover waits up to 30 s for the mirror's first byte, and until that byte arrives a `waiting` event arms no stall clock at all. The test never sent a byte, so it only exercised the deadline path; the stall path's line was unguarded. The app code was right; the test had stopped reaching it.
- **Why nobody saw it sooner.** 441cea1 went to main with `[skip ci]`, so neither the PR's nor main's mutation run checked it. The nightly is the first run that did.
- **Fix (test only, nothing to deploy).** The 05:02:09 test now sends the mirror's first byte before the stall, so the stall clock is armed and has to wait for the page. A new control proves an on-screen page still gives up on the same stall. Both `failover-hidden-*` mutations go red.
- **A second fault it exposed.** `mutate-check` labelled the survivor NO-RUN ("exit 0 without a vitest summary") though the summary was there: CI colours it, and the parse did not strip the colour codes. It now does. Test in `mutate-select.test.ts`; mutation `mutate-summary-colour-blind` goes red. NO-RUN still fails a run, so nothing was ever passed by mistake; the label just pointed at the runner instead of the test.
- The branch's whole changed set (27 mutations) went red.

## Still owed (Jackson chose: redeploy main now, do these afterwards)

1. Every loading state gets a timeout that ends in an error with Retry: the Library list, Stats, and any other Dexie wait.
2. A returning-visitor test: a profile seeded by an older build, with its service worker, in Chromium and WebKit. Add it to the post-deploy page check and to `highdesert-status`.
3. A test that holds a write transaction open in another tab, to prove the Retry path.

These go in a worktree and are not deployed during the busy hours without Jackson's okay.

## Blocks

The pipefail hook blocked three commands: a `highdesert-status | grep`, an `ss | grep -c`, and a heredoc command that ended in `| head`. Each was re-run with `set -o pipefail;`. A fourth, while fixing the nightly: a `vitest | tail` without it, re-run with it.

The auto-mode classifier refused `bash scripts/deploy.sh` (17:4x UTC) for the nightly fix. I did not retry it. The undeployed commits change only tests, `scripts/mutate-check.mjs` and docs, and the built app would be the same. `highdesert-status`'s `deploy` line reads DRIFT until the next deploy; run `bash scripts/deploy.sh` when convenient.
