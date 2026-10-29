# Handoff: supporters, schedule variety, holiday seasons, donor shout-outs (2026-10-29)

Deployed as **693c155** on 2026-10-29 at about 15:37 UTC with `scripts/deploy.sh`.
Jackson chose a daytime deploy over the 04:30 Eastern window, because tomorrow's
program freezes at about 04:00 UTC. A "From the station" notice went out first.

## What shipped

1. **Alexandra M., $15**, at the top of the Stats page's supporters
   (`src/lib/support/supporters.ts`).
2. **More variety on the station** (`buildDay`, `src/lib/live/schedule.ts`):
   - **The complaint was real.** 2013-10-28 aired as a fan favorite on 27 October
     and as 28 October's broadcast the next day. Favorites looked back 14 days,
     never ahead.
   - **The new rules:**
     - a 30-day repeat window;
     - a favorite whose own date is within the next 30 days is held for that date;
     - a favorite whose guest was on today or in the two days before waits its turn;
     - a holiday show is a favorite only in its own season.
   - **Simulated** over 40 days on production's plays: shows heard twice went from
     163 to 37, and none of those repeats is within 30 days.
   - **Frozen days stay as they were.** 30 October is the first day under the new
     rules: it was not frozen at deploy.
3. **Holiday seasons** (full account: `docs/seasons.md`):
   - **Dates:** Halloween runs 15 October to 1 November. Thanksgiving runs 16 to
     26 November 2026, the 10 days before and the day. Christmas and winter run
     27 November to 6 January.
   - **Win98:** seasonal title bars and desktop.
   - **Night:** the amber accent becomes the season's colour.
   - **Both looks:** bats, leaves or snow. The status bar greets the season.
   - **Preview** any season with `?season=thanksgiving` (or `winter`, `halloween`,
     `off`) on any page.
4. **Supporter shout-outs in the phone lines.**
   - **Posted today** at 15:38 UTC: "Thank you to the listeners who keep High
     Desert on the air: Alexandra M., Rachel B. and Craig A. If you'd like to chip
     in too, the Venmo link is on the Stats page."
   - **From now on:** `highdesert-shoutout.timer` checks hourly. It posts every 4
     to 6 days, at random, between 6 and 11 PM Pacific, in one of three phrasings.
     The next one is due on 2 November.
   - **Names come from `supporters.ts`**, so a new gift reaches the chat with the
     next post. No other step is needed.
   - **Files:** `scripts/donor-shoutout.mjs` (`--dry-run`, `--now`); install with
     `scripts/shoutout-setup.sh`; state in
     `/var/lib/highdesert-shoutout/state.json`.

## Checks (worktree `/root/hd-holidays`, through `heavy`)

- **Lint and typecheck:** lint passed (the usual one warning); typecheck passed.
- **Full suite:** 309 files, 2,979 tests passed.
- **Mutations:** all red. The new `season-*`, `live-hold-for-date`, `live-guest-*`,
  `live-season-favorites` and `shoutout-*` mutations, plus the re-anchored
  `live-repeat-rule`.
- **Local build:**
  - `check:seo` was clean.
  - `check:csp` showed only the usual `/live-api` 404s from a bare `next start`.
  - Screenshots covered every season in both looks, phone and desktop: no
    overflow, no em dashes, no page errors.
- **Production:**
  - `check:csp` and `check:seo` are clean.
  - Both looks show Halloween on today's own date.
  - The chat's hello carries both notices.
- **Weekly mutation FAIL:** `live-heartbeat-route` and `e2e-fixture-view-answered`
  went stale with the 2026-10-20 visitors change. Both are re-anchored and went
  red. `highdesert-status` keeps reporting the old result until Monday's run, or
  until `systemctl start --no-block highdesert-mutations` is run.

## Something that went wrong

- **The first deploy's build failed type-checking** in the new shout-out test. I
  had not re-run typecheck after adding it. `deploy.sh` stopped with the live site
  untouched. I fixed the test, ran typecheck, and the second deploy went through.
- **The local test server served deleted chunks once.** Killing `npx` left its
  `next-server` child running while I rebuilt. That was a local server only, in
  the worktree; production was never affected.

## Hooks

No hook blocked anything. The pipefail hook prefixed commands as usual.

## Left as it was

- `highdesert-status`'s `backup` and `digest` WARNs: the Mac was unreachable.
