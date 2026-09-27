# Handoff: launch night's lessons, turned into the product (2026-09-27)

Mandate: take what launch night showed (`docs/launch-summary-2026-09-26.md`)
and build it in: measure the path from arriving to listening, make a phone's
first screen one tap, give callers a place to call from, and make the room
at the call box visible. Also get the tuned-in e2e tests off archive.org.

Everything below is merged to `main`, deployed and pushed. `highdesert-status`
is all OK apart from one `release` WARN, explained at the end.

## What shipped

| PR | What | Deployed |
|---|---|---|
| #37 | **The arrival funnel.** First visit, saw Live, tuned in, first call, counted per UTC cohort day and per device (phone narrower than 768 px, fixed at arrival). Counters only (`funnel_daily (day, device, step, n)`), no ids. `GET /api/stats/funnel`, a `funnel` line on `highdesert-status` with phones on their own. Headless checkers keep out of it | 04:45 UTC, `deploy.sh` (schema applied first) |
| #38 | **Calling from** (optional, suggested from the browser time zone only, filtered like names, change once per 10 min, clear any time). **The room at the call box** ("N tuned in now" from the one presence function, batched tune-in lines with a Hide setting, a one-time first-caller hint). **A phone's first screen**: one Listen live card with the show, guest and live count; a phone's first visit to `/` goes to `/live`. **e2e on a fixture mirror**: the stack serves a 4-hour silent MP3 at its own `/mirror` and the tuned-in specs stream from it | 06:04 UTC, `deploy.sh` then `deploy-live.sh` (live schema: place columns) |
| #39 | **Nothing over Listen live on a phone.** Found verifying #38 on production at 390 wide: the card was in the page at about 0.6 s but the first-visit boot sequence covered it until about 3.3 s (a tap there only dismissed the overlay), then the "Loaded 1,312 episodes" toast sat on its label until about 5 s. Phones now get the quick splash; the seed does not toast on `/live` | 06:53 UTC, `deploy.sh` |

Every deploy ran under `nice -n -15 ionice -c2 -n0`.

Also in these PRs, found along the way:

- The mobile a11y checks of `/` were testing a page no phone sees any more.
  They are the desktop's now. `/live` had no axe scan at all. It has one on
  both viewports, and its first run found that the day's log scrolls with no
  tab stop (fixed: a focusable, labelled region).
- The e2e fixture now also answers `POST /live-api/tuned` in the page, so a
  phone test on production does not tell the real room that a listener tuned in.
- The Live specs' random call and name tokens could be masked by the chat
  filter: on #40's CI, "tefcko" went out as "te***o" and the rename spec
  could not find its own call. Tokens are now three words from a fixed list
  (`e2e/tokens.ts`). A unit test puts every one of the 13,824 through the
  real moderator.
- The `live-name-wait` mutation's anchor matched twice once the place handler
  existed. It is fixed, and all 544 mutation anchors were checked for
  uniqueness.

Tests: 1,726 vitest tests. Every change has a mutation, and all of them went
red. CI was green on each PR.

## Verified on production

- At 390 wide (`e2e/live-qa.spec.ts`, mobile project, every write answered in
  the page):
  - a phone's first visit to `/` lands on `/live`;
  - the Listen live card is fully in view, with the title, guest and count;
  - nothing ever covered it (the spec records the boot sequence and the toast
    as they happen, and it failed against the build before #39);
  - one tap plays.
- Timing on production, measured by hand:
  - the card at 0.48 s and the splash gone at 0.50 s;
  - before #39, the splash was gone at 3.3 s.
- The funnel answers, and `highdesert-status` shows it with the phone split.
- `check:csp` passes on 7 routes: no violations, no console errors, no em
  dashes.
- `/live-api/place` and `/live-api/tuned` exist on production, and without
  our Origin they are refused (403) before any caller is made.

## The funnel: before, and how to read after

`docs/funnel.md` has the method and the numbers. The "before" window is
1 h 18 min on one cohort day (06:02:55 UTC snapshot):

- phones: 20 arrivals, 20 saw Live, 13 tuned in (65%);
- desktop: 8 arrivals, 4 tuned in.

It is small and was taken at a quiet hour. It does not repeat launch night's
"three in four never pressed play", which counted regulars too, at the Reddit
peak.

**After is the cohorts from 2026-09-28 on.** The 09-27 cohort straddles the
deploys, so it counts as neither. The query is in `docs/funnel.md`. Nothing
has been measured for "after" yet. Hold a verdict until a few hundred phone
arrivals are in.

## Open: the `release` WARN (not caused by these deploys)

`release` reads 4.2% failed starts against a <3% target, 2.2 days into its
7-day window. There were 17 failures from 01:47 UTC to the end of the session.
14 of them are one episode, `1993-06-20 Coast to Coast AM, Al Bielek,
Philadelphia Experiment`, tonight's live fan-favorite slot. The other 3 are
iOS stalls on "Spooky Matter, Ghost Stories", all recovered by the mirror.

- **iOS stalls on archive.org, recovered by the mirror.** The failover works
  as designed. They still count as failures.
- **A burst at 04:34:25, the second that slot started.** Several listeners hit
  it at once and archive.org answered with `code=4` format errors on two
  browsers. Three more (iOS and Firefox) got `play-rejected`. That fits a
  backgrounded tab being refused a new `play()` at a slot change. It is the
  only such burst in 3 days of data.
- **5 of the 17 did not recover:** the three `play-rejected` and two iOS
  stalls on the mirror after an archive.org error. The file is pinned, and a range request to it answers 206 in
  about 20 ms.

What to look at next:
- whether iOS Safari stalls on this file in particular (a VBR header?);
- whether a slot change in a background tab should wait for the page to be
  visible rather than call `play()`.

This is a reliability question, separate from this work.

## Loose ends

- The `warm` line reads `stopped-at-floor`: 318 pinned, down from 331. The
  disk floor stopped it, not a failure, so nothing needs doing now.
- The local e2e stack in the scratchpad (ports 3013 to 3015) was stopped at
  the end of the session.
