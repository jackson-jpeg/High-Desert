# Station Breaks

> **The audio is off the air (2026-11-10), the chat cards stay.** After the
> first spot (SoGoJet, 7:26 PM Pacific on 9 November), listening went from 20
> to 10 at the break and stayed near 13 for the next twenty minutes; at no
> other show change that day did it move. The lines said "Lol was that an ad".
> Jackson: pull the audio, keep the cards "as long as it doesn't interrupt the
> show". `AIR_SPOTS = false` in `src/lib/live/breaks.ts`: the program stays
> exactly as frozen (no break moves a show), nothing plays in the gap, and the
> five cards a week appear in the phone lines in the station ID gap at their
> boundary, `url: null`. An old tab that still reports a spot heard is
> accepted and not counted. The /stats panel is unchanged. Everything below
> describes the spots with `AIR_SPOTS = true`; flip it to bring them back.

Shipped 2026-11-09. Sponsor spots for Jackson's own iOS apps, done as an
old-radio station break, not as ads: SoGoJet, Screen Receipts, Sim Sunday.

## What a listener gets

- **On the air:** one or two 18-second spots a day, only in the gap between two
  shows, never inside one. The spot plays on the player's own element (the
  bridge, `src/audio/engine.ts`), then the usual station ID, then the next show.
- **In the phone lines:** on five of those a week, a "Station break" card at
  the moment the spot starts, for everyone in the lines, tuned in or not:
  `*** The station is going to a break ***`, a window "On air: station break"
  with a blinking lamp and "Cart 07", a cart machine LCD that keeps time with
  the spot on the station's clock, the print ad (serif copy, the app's name in
  the station's bitmap face, a small plane flying across while it plays, a
  dashed "Clip and save" coupon with the App Store's own price, Get the app),
  "A word from the guy who keeps this station running.", Mute breaks, and
  `*** Back to the show ***` once the spot is over. Win98: a gray window,
  newsprint and ink. Night: dark card stock, amber ink. Not cream (Jackson).
- **Mute breaks:** the card's button, or the setting (Night: beside "Hide
  tune-ins" in the lines' header; Win98 Notepad: Format, Mute Station Breaks).
  This browser then hears the station ID in a spot's place and sees no cards
  (`hd-breaks-muted` in localStorage). Muting mid-spot drops it at once.
- **On /stats:** "Station sponsors" at the very bottom, after History and apart
  from Supporters: one app per visit, in turn, as the same print ad.
  Supporters now reads "High Desert runs no outside ads." (it said "no ads").

## When (`src/lib/live/breaks.ts`)

From Live's listener profile (`/api/stats/traffic?range=30d`, read
2026-11-09): listening peaks 8 to 9 PM Pacific (about 11) and holds near 10
until 12:30 AM Pacific.

- **evening:** the show boundary nearest 8 PM Pacific (90 min before to
  150 min after), every day;
- **late:** midnight Pacific, the top of the station day (3 AM Eastern: "still
  up at 3 a.m.?"), four days a week.

| Day (Pacific) | evening | late (midnight) | card |
|---|---|---|---|
| Sun | Sim Sunday | | evening |
| Mon | SoGoJet | Screen Receipts | late |
| Tue | SoGoJet | | evening |
| Wed | SoGoJet | Screen Receipts | |
| Thu | SoGoJet | SoGoJet | evening |
| Fri | SoGoJet | Screen Receipts | late |
| Sat | SoGoJet | | |

11 spots a week (SoGoJet 7, Screen Receipts 3, Sim Sunday 1), 5 cards. Change
it in `WEEK`; `breaks.test.ts` holds the counts.

**The clock.** A break sits where a show ends: the spot, 1 s, the station ID,
the next show. The shows after it move later until a gap absorbs it, usually
the slack before 10 PM. **The 10 PM request slot never moves.** A show playing
in full is never shortened; only a show the day already cut short before
10 PM (`MIN_CUT_MS`) may lose a little more of its cut end (at most two
breaks' worth, under a minute). When neither works, the break skips that day.
Applied at read time, after the request and before the outage swap and the
breaker (`assembleSchedule`), and on the Tonight pages, so every client, the
breaker and the page agree. Nothing before `BREAKS_FROM_MS` (2 PM Pacific on
2026-11-09) gets a break, so past days and the show on the air at the deploy
kept their times. The schedule carries `breaks: [{id, day, slot, spot, cart,
url, durationSec, card, start, end}]`.

**The browser** (`src/audio/live-controller.ts`): entering a gap that holds a
break, it plays the spot first (`playBridge(url)`), the ID after it. A tab that
tunes in more than 3 s into a break hears the ID, never half an ad. A show
whose file ran short reaches the gap early: the ID now, the spot at its time.

## The spots (`data/station-breaks/spots.json`)

Voice: Piper (self-hosted, no API), `en_US-ryan-high`, length scale 1.08
(the pace; nothing is time-stretched afterwards). Each sentence is rendered on
its own and followed by 0.4 s of silence (`sentencePause`), so "Roswell.
Rachel, Nevada. Point Pleasant." lands as three places. Then ffmpeg: a 1.4 s
synthesized three-note sting (E5, A5, C#6: not any network's chime), the
voice, a warm vintage broadcast texture (`CHAINS.warm`: 120 Hz to 5.5 kHz, a
+3 dB presence lift at 3 kHz, 2:1 compression, faint pink hiss, no soft
clipping), two-pass loudness to the station ID's -22.8 LUFS, mono 64k MP3.
17.6 to 21 s each.

**Revised 2026-11-09 evening** (Jackson: "too tinny and words blur
together"). The first cut was 300 Hz to 3.2 kHz with soft clipping and 4:1
compression, at -21 LUFS, a phone line more than a radio. Clarity was judged
by transcribing each take with a local Whisper (base.en) and counting words it
got wrong: ryan beat norman (norman's "Roswell" came out "Barats"), the warm
chain beat the barely-filtered one, and three lines were rewritten for the
voice, not the meaning: "Free, on the App Store." (the comma stops ryan
swallowing "App Store"), "real flight prices" (ryan's "fares" reads as
"fizz"), and Sim Sunday's "Import your league from Sleeper, or E S P N. Draft
it, sweat it, gloat about it, and do it again." (one-word sentences such as
"Draft. Sweat. Gloat. Repeat." came out as noise). Piper takes vary run to
run; the committed takes are the best of four by that count.

To re-record: edit a script or the voice in `spots.json`, then
`node scripts/make-station-breaks.mjs [id]`, commit `public/audio/breaks/` and
`src/data/station-break-audio.json` (durations are part of the schedule's
timing; a test checks the files against it), deploy. Audition another voice
without touching the repo: `--voice en_US-norman-medium --out /tmp/x`. A
human take: a mono WAV at `data/station-breaks/recorded/<id>.wav` is used in
place of Piper, with the same sting and texture. `--chain light`
(the filter barely there), `--length-scale` and `--noise-scale` exist for
auditions. Piper lives at
`~/.local/share/hd-piper-venv`, voices in `~/.local/share/hd-piper-voices`
(huggingface.co/rhasspy/piper-voices). Never imitate a real host.

Copy is held true to each app's App Store listing: Screen Receipts is $0.99,
not free; Rachel and Point Pleasant have no airport, so SoGoJet says "the
airport nearest whatever's out there" (`sponsors.test.ts`).

## Does it work? (`sponsor_daily`)

Per UTC day, per app: `air/heard` (the spot started for a tuned-in listener),
`chat/seen`, `chat/click`, `chat/mute`, `stats/seen`, `stats/click`. POST
`/api/stats/sponsor`, read `/api/stats/sponsors?days=7|30|90`. Counters only.
Read it in:

- `highdesert-status`'s `sponsors` line (7 days, reported, never judged);
- /stats in admin mode: a 30-day table under the Station sponsors ad.

## Tests and mutations

`src/lib/live/__tests__/breaks.test.ts`, `src/audio/__tests__/live-breaks.test.ts`,
`src/audio/__tests__/bridge-break.test.ts`,
`src/components/live/__tests__/station-break-card.test.tsx`,
`src/lib/support/__tests__/sponsors.test.ts`,
`src/services/stats/__tests__/sponsors.db.test.ts`,
`src/app/api/stats/sponsor/__tests__/route.test.ts`, the status test's
sponsors block. Mutations: `breaks-*`, `bridge-break-*`, `live-break-*`,
`break-card-*`, `sponsor-*`, `status-sponsors-line`.
