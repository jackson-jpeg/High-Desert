# Who hosted each show, and a show plays to its end (2026-11-12)

Two changes to the live station, made the same day, with the Request Line
moved from 10 PM to 8 PM Pacific beside them.

## Only Art Bell's own nights air

At 2:42 AM Pacific on 2026-11-12 the phone lines filled with complaints: the
station was playing George Noory. The slot was "2001-11-12 - Coast to Coast AM
with Art Bell - Eugene Mallove - Infinite Energy Magazine". The archive.org
collection (`ultimate-ultimate-art-bell-collection`) names every file "with
Art Bell", and the catalog had no host field, so nothing could tell.

**The source of truth is the Art Bell Archive's episode list**,
<https://artbellarchive.org/episodes.json>: 1,489 of Art's broadcasts, built
from artbell.com's own show logs. Each entry names the archive.org file it is
(`archive_audio_url`), so the catalog joins to it by file name, not by date.
That night is not in it. `scripts/classify-hosts.mjs <episodes.json>` decides:

- **In the list, no guest host:** Art's (1,381 shows, the 2015 Midnight in
  the Desert shows among them).
- **In the list, guest-hosted:** the description says so ("Guest host Hilly
  Rose welcomes ..."). Six Hilly Rose nights (1998 to 1999), Whitley Strieber
  hosting (1999-05-14), Ramona Bell (1997-12-24, 1999-03-21) and Mark Fellen
  (2005-05-08).
- **Not in the list:** 22 shows, decided by hand in `REVIEWED`, with the
  reason. 16 are Art's: the archive has the same night under another file (a
  different rip, a split hour, a misdated rebroadcast), or it is Art himself
  (the Gabcast call-in, like his Larry King Live appearance). 6 stay off: the
  Noory night, and five nights nobody can vouch for (1999-03-07, 2002-02-19,
  2002-07-15, 2002-09-22 a Sunday, 2002-11-11 after Art gave up the
  weeknights). George Noory filled in often from 2001 and took the weeknights
  in late 2002, so an unverified 2001 or 2002 night is the likeliest place
  for another.

1,397 are Art's and 16 are not. `data/hosts.json` holds every show with its
evidence. `src/data/not-art-hosted.json` is the exclusion list the schedule
imports (`NOT_ART_HOSTED`). The phone lines' service reads the same file
through the symlink `services/live/lib/shared/not-art-hosted.json`.

**What it does:**

- `isAirable()` refuses them, so no day, filler, outage swap, breaker swap or
  request ever puts one on.
- `applyHostSwap()` swaps one out of a day frozen before the list existed, at
  read time (kind `host-swap`, slot times unchanged), on the station and on
  Tonight.
- The Request Line refuses to nominate one: 409 `not-art`, "Someone other
  than Art hosted that night, so the station does not play it. Pick another."
- The library keeps them. They are still part of the archive, and a listener
  may play one on purpose.

**Adding shows to the catalog:** `src/lib/live/__tests__/hosts.test.ts` fails
until every catalog row is classified. Save a fresh `episodes.json`, run
`node scripts/classify-hosts.mjs <path>`, add any show it cannot place to
`REVIEWED` with the reason, and commit `data/hosts.json` and
`src/data/not-art-hosted.json` together. Unverified means off the air.

## A show plays to its end

The station laid shows end to end from midnight while the next one would
*start* before midnight, and cut the last one there. Before the 10 PM request
it cut one more when nothing fitted. Frozen days from 2026-10-20 to 11-12 cut
1 or 2 shows a day, 23 to 337 minutes of show (51 on the 12th). Request nights
cut more at read time: a three-hour pick at 10 PM ran to 1 AM and lost an
hour, and the night after it was cut at midnight too.

`buildDay` now packs two stretches with fixed ends: midnight to the request
hour, and the request hour to midnight. In each, a show goes in only if it
ends, station ID included, inside the stretch, and leaves either almost
nothing (`TIGHT_MS`, 2 minutes) or time that one or two more shows can close
(`packer()`: it looks ahead over the lengths still available). Over 6 hours
left counts as always closable. Order is unchanged: on this date oldest first,
then favorites by plays, the guest gap. When the day's own queue has nothing
that fits, a filler from the ranking does: one not aired in 30 days and not
held for its own date first, then one held for its date, then a repeat.

`applyRequest` packs the night after the winner the same way: the frozen
night's shows in their order, then the ranking, then the rest of the catalog.

Fragments under 20 minutes (`MIN_PROGRAM_SEC`, 22 files: a minute of a show,
one segment) are not programmed, since they end as abruptly as a cut. A
listener may still request one.

**Measured** on the real catalog and plays (60 days from 2026-11-14, and three
request winners a night: a 3.5 hour show, the 50th and the 150th favorite):

| | before | after |
| --- | --- | --- |
| shows cut, frozen days | 1 or 2 a day | 0 |
| shows cut, request nights | most nights | 0 |
| longest quiet gap, frozen days | none (a cut instead) | 2.1 min |
| longest quiet gap, request nights | none (a cut instead) | 2.1 min |
| repeats inside 30 days | 0 | 7 in 60 days, all 35 to 40 minute fillers |

The quiet between shows is the station ID and its quiet bed, as before. The one
case left that packing cannot help is a request winner longer than the
time to midnight (4 hours at 8 PM; two catalog files), which is cut there.

## The Request Line at 8 PM

8 PM Pacific from the station day 2026-11-14 (`REQUEST_HOUR_FROM`,
`requestHourOf()` in `src/lib/live/pacific.ts`); 10 PM before. Days are frozen
a day ahead with the stand-in on the hour, so the hour belongs to the day: the
13th was frozen for 10 PM and still airs its request then. Voting still closes
at 6 PM Pacific. Every listener-facing "10 PM" now comes from the day
(`requestHourLabel`, `pacificHourLabel`). At 8 PM a three-hour pick has four
hours before midnight instead of two.

Tests: `src/lib/live/__tests__/schedule.test.ts` ("never cuts a show", "packs
the real catalog", "only Art Bell's own nights air", "packer", the Request
Line block), `hosts.test.ts`, `services/live/test/requests.db.test.mjs`
("refuses a night someone other than Art hosted"). Mutations: `hosts-*`,
`pack-*`, `request-hour-*`.
