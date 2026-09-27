# The arrival funnel: from arriving to listening

On launch night (2026-09-26) three in four people online never pressed play,
and 75% of them were on phones (`docs/launch-summary-2026-09-26.md`). Nothing
measured the path from arriving to listening, so nothing could say whether a
change to it helped. This is that measurement.

## What is counted

Four steps, as counters per **cohort day** (the UTC day a browser first
arrived) and **device**: `phone` if the window was narrower than 768 px when
it arrived (the app's own mobile breakpoint), otherwise `desktop`. The device
is fixed at arrival, so a phone turned sideways stays a phone for the rest of
its funnel.

| Step | When a browser reports it |
|---|---|
| `visit` | It arrived with an empty library: a first visit. Decided on the first page of the app it reaches (`/` or anything in the shell) |
| `live` | The Live screen was on screen (`LiveStation` mounted) |
| `tune` | It tuned in to the station (`tuneIn()`, from any surface) |
| `call` | A call it made on the phone lines went through (201) |

- **Each step is reported once per browser, ever**, against its cohort day.
  "Once" is kept in the browser (`localStorage["hd-funnel"]`), written
  *before* anything is posted. A browser that cannot store it never counts, so
  it cannot count itself on every page load.
- **Browsers that were here before the funnel are excluded for good.** A
  browser that arrives with a library already in it is marked excluded and
  reports nothing. So the funnel is new arrivals only, never mixed with
  regulars.
- A step that happens before the arrival verdict (the Live screen mounts
  before the library count answers on a direct load of `/live`) waits for it,
  and is reported or dropped with it.
- **No ids.** The server keeps `funnel_daily (day, device, step, n)` and nothing else:
  no session, no address, no browser id. Like every public counter here it can
  be inflated by someone who wants to; the POST is rate limited per client
  (10 a minute).
- Headless checkers keep out: `csp-check` marks its browser excluded,
  `presence-check` and the e2e fixture answer the POST in the page.

Code: `src/services/stats/funnel-client.ts` (browser),
`src/services/stats/db/funnel.ts` and `src/app/api/stats/funnel/route.ts`
(server), `funnel_daily` in `scripts/schema.sql`.

## Reading it

- `highdesert-status` has a `funnel` line: the last 7 days' cohorts, each step
  as a share of their first visits, then the same shares for phones alone.
- `GET /api/stats/funnel?days=7|30|90` gives every cohort day per device, the
  totals and `byDevice`.

A cohort's later steps keep arriving for as long as its browsers come back,
so the most recent days are always still filling in. Compare windows of
equal age.

## Before and after the phone's one-tap "Listen live"

The change: on a phone, `/live` now opens with one "Listen live" card above
everything else. It shows the show on the air, its guest and how many are
tuned in, and the tap tunes in, with audio starting inside the gesture. A
phone's first visit to `/` goes straight to `/live`. Before it, a phone's
"Tune in" sat below the studio's sign, clock and listener count, under the
phone lines' button.

The funnel shipped a release ahead of the change, so there is a "before" to
compare with. The numbers are recorded here as they are measured, phones
first; nothing below is a result until it has a date against it.

### Before (funnel live, old phone screen)

The funnel went live at 2026-09-27 04:45 UTC (#37). The new phone screen
(#38) went out at 06:04 UTC. Snapshot taken just before it, at 06:02:55 UTC:
one cohort day (2026-09-27), 1 h 18 min of arrivals, late Saturday evening
Pacific.

| Device | First visits | Saw Live | Tuned in | Called |
|---|---|---|---|---|
| Phone | 20 | 20 (100%) | 13 (65%) | 0 (0%) |
| Desktop | 8 | 7 (88%) | 4 (50%) | 1 (13%) |

Read with care:

- **It is small.** 28 arrivals over 78 minutes; one phone either way moves
  the tune-in share by 5 points.
- **It is not launch night.** Launch night's "three in four never pressed
  play" counted everyone online, regulars included, at the Reddit peak. This
  counts only new browsers, at a quiet hour, most of them landing on /live
  from a link. Saw Live at 100% on phones is that: they arrived there.
- The old screen already worked for most of the phones that arrived on it:
  65% tuned in. The new screen's job is the other third.

### After (one-tap Listen live, phones past the welcome page)

Cohort days are UTC days, and the 2026-09-27 cohort holds arrivals from both
sides of the 06:04 deploy, so it is neither. **"After" is the cohorts from
2026-09-28 on**, entirely after both #38 and #39 (#39 took the boot sequence
and the catalog toast off the card on phones):

```bash
curl -s 'https://highdesert.space/api/stats/funnel?days=7' \
  | jq '.cohorts | map(select(.day >= "2026-09-28" and .device == "phone"))'
```

_Not measured yet._ Compare phones with phones, and hold a verdict until
there are at least a few hundred phone arrivals: at 20, the difference
between 65% and 75% is two people.
