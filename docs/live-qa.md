# Live — what a real listener hit, and a first-time listener's walk

2026-09-25. Jackson used Live Broadcast for real after it shipped (1455126) and
hit six bugs that `e2e/live.spec.ts` and `e2e/live-chat.spec.ts` had passed
straight over. Those specs checked that the machinery ran: two clients were in
sync, and a message arrived. They never did what a listener does: rename,
reload, pause, come back, leave.

Every bug below was first reproduced as a failing test in
**`e2e/live-qa.spec.ts`**. It went red 12 times on 1455126 (desktop and
mobile); the log is in the session scratchpad as `qa-red-main-1455126.log`.
Only then was it fixed. Each fix also has a unit test and a mutation in
`scripts/mutate-check.mjs` that the suite is required to catch.

Run it the way CI does: one origin, with the phone-lines service behind it.

```bash
# app on :3013, highdesert-live on :3015, scripts/live-e2e-stack.mjs on :3014
E2E_BASE_URL=http://127.0.0.1:3014 E2E_LIVE_ADMIN_TOKEN=… npx playwright test e2e/live-qa.spec.ts
```

The audio tests skip themselves when archive.org is unreachable. They play
real audio. Their heartbeats go to the e2e database, never production.

## The six reported bugs

### 1. "Change name does nothing"

**What was wrong.** A cold rename worked in Chromium and in WebKit (installed
on the VPS for this). The listener's session never sent a rename at all. Two
defects could each swallow the click, and both are fixed:

- **Save was silently disabled when the name was too long.** Past 32
  characters Save went grey, and the only hint was a small "33/32". Pressing it
  did nothing. The red e2e reproduced this as a click timeout. Save now stays
  pressable. `nameProblem()` checks the name locally and gives the reason
  inline: "Names can be at most 32 characters.", "Type a name first." Server
  refusals (the filter, a taken name, the 10-minute limit) also appear inline.
- **Pressing a small Win98 button made it grow.** The pressed padding was the
  medium size's for every size, so "Change name" went from 86×25 to 102×29 px
  on mousedown. At the end of a wrapping row, it could jump to the next line
  under the pointer before the click landed. Pressed padding now only shifts
  between sides (`Button.tsx`). `button-press.test.tsx` holds that for every
  size, from the classes the component renders.

**e2e:**
- The next call carries the new name, in the sender's and another client's view.
- The name survives a refresh.
- Too long, refused and rate-limited each show their reason inline.
- Pressing Change name does not move or resize it. This test was red on the
  old build (86×25 → 102×29).

**Mutations:**
- `name-too-long-says-why`
- `name-save-never-silently-disabled`
- `button-press-no-grow`

### 2. The live count

**What was wrong.** Pausing tuned the tab out (see 3), and a reload forgot it
was tuned in. Together those dropped a listener from the live count on the
most ordinary actions. On top of that, the heartbeat only beat when `tuned`
changed, so a pause or a resume moved the count up to a minute late.

**Fix.** There is still one source: `getPresence().live`, fed by the heartbeat's
`live` flag from `tunedInLive()`. A tab counts when its playing source is the
station. `tunedInLive()` is now false while held paused. `usePresence` beats
the moment `tunedInLive()` flips, whatever flipped it: tune in, pause, resume,
leave, or a reload's first ▶.

**e2e:**
- Join, refresh, press ▶: still counted, and the on-screen `data-live` shows
  the same number.
- Leave: the count drops within one presence poll.

**Mutations:**
- `live-held-not-live`
- `live-beat-on-playing`
- `live-reload-comes-back-held`

### 3. Station controls

**Leave the station** used to call `tuneOut()`, which only cleared state. The
audio kept playing and the show stayed in the player. `leaveStation()` now
tunes out, stops the player the way the player stops itself (the
`live-stop` global, `stopPlayerForLive()`), and deletes `last-episode-id`, so a
refresh does not bring the show back.

**A library show while live** already tuned out. That now also holds while
the station is held paused, which is a new state.

**Pause** used to tune out, which dropped the listener from the count and
turned the next ▶ into an ordinary resume from the paused second. A pause now
**holds** the station:
- It stays tuned, with `paused: true`, and the show stays in the player.
- The program timers stop, so no station ID and no next show start behind a
  paused player.

▶ from anywhere (the bottom player, MediaSession, `togglePlay`) reaches
`takeLiveResume()` synchronously at the top of `resumePlayback`, inside the
gesture:
- If the same show is still on, the playhead is moved to the live second and
  the element resumes.
- Otherwise the station starts whatever is on now.

The Studio says "Paused." and offers **Rejoin live** beside Leave. A reload
comes back held, via `sessionStorage` `hd-live-tuned`.

**e2e** (one test for each of these):
- Leave stops the audio, clears the player, and stays cleared after a refresh.
- A library show leaves the station. On a phone the test now uses the sheet's
  ▶ Play: a tap alone starts nothing, and the reload re-primes the element, so
  "src changed" was not evidence.
- Pause stays in the station, and resume lands within 2 s of the station's
  second.

**Mutations:**
- `live-pause-holds`
- `live-held-starts-nothing`
- `live-resume-jumps-to-live`
- `live-resume-hook-wired`
- `live-leave-stops-player`
- `live-stop-handler-wired`
- `live-leave-forgets-show`

A reload also found a first-visit bug. A first-time listener tunes in before
the library has seeded, so the station plays a row made from the slot. That
row has no id, so neither `last-episode-id` nor history was ever written, and
a refresh brought back an empty player with nothing for ▶ to resume.
`browser-station.ts` reads the rows again when the seed settles and gives the
player the real row (`adoptRow`). Mutations: `live-adopt-library-row`,
`live-prefetch-after-seed`.

### 4. Lines

The line never changed. `lineFor()` is a stable function of the client ref.
But the SSE hello's `recent` and the resume's catch-up sent the stored
**index**, while the broadcast and the header sent the label. After a reload,
a caller's own calls read "5" under a header saying "Line 6".
`publicMessage()` now maps the line to its label once, for every shape.
`messages.db.test.mjs` checks that one caller's label is equal in the hello,
their POST, the broadcast, the replay and the resume. The e2e checks the same
across a refresh. Mutation: `live-line-label-everywhere`.

### 5. The Studio's heading

It was a `span` holding "Coast to Coast AM - Colonizing the Moon", the same
lead for every Coast broadcast. It is now an `h2` with the episode title, and
the show is in the kicker ("Now playing · Coast to Coast AM").
`splitShowTitle()` splits at the first " - " only. Mutations:
`live-heading-is-episode`, `split-show-title-first-dash`.

### 6. The placeholder

"Call in as Retired Lighthouse Keeper in Ely" did not fit on desktop, and at
390 wide it needed 267 px in a 266 px box. Names can be 32 characters, so no
placeholder that carries the name can fit. It is now "Call in…". The header
already says who you are. The e2e measures the text against the box and
requires that it names nobody. Mutation: `live-placeholder-short`.

## The first-time listener walk

This is a scripted walk of the whole flow in a fresh profile, at 1440×900 and
at 390×844:

1. Land on `/`.
2. Find Live.
3. Read the Studio.
4. Tune in.
5. Open the phone lines.
6. Change name.
7. Call in.
8. Pause.
9. Rejoin.
10. Reload while live.
11. Leave.
12. Visit Radio and Stats.

Each step took a screenshot, and console errors and 4xx/5xx responses were
recorded. Findings, all fixed unless marked otherwise:

| # | Found | Fix | Proof |
|---|---|---|---|
| A1 | **The welcome page never mentions the station.** A first visit's only way on was "Enter the archive", and nothing hinted that a live station exists. | "Or tune in live — the station is on the air" under the Enter button, going to `/live` (and marking the visit, like Enter). | e2e "a first visit can find the station"; `welcome-live.test.tsx`; mutation `welcome-offers-live` |
| A2 | **At 390 wide the Studio was 555 px wide.** The grid had no explicit column, and an implicit track is sized to max-content (the untruncated "Up next" title). The clock was clipped, "Up next" ran off the edge, and the **live count was off screen entirely**. | `grid-cols-[minmax(0,1fr)]` on a phone. | e2e "nothing in the studio is wider than the screen" (red on the old build); mutation `live-studio-grid-shrinks` |
| A3 | **On desktop the call-in box started below the fold, and the list sat on the oldest call.** The Window body is a scrolling block, not a flex column, so the chat's `flex-1` grew to its content. The whole window scrolled instead of the list, and "follow new calls" had nothing to scroll. | The chat fills its window (`h-full`), so the list scrolls itself. | e2e "the call-in box is on screen and the newest call is in view" (red on the old build); mutation `live-chat-fills-window` |
| A4 | **Seeking while live was undone silently.** ±15, +30, the scrubber, the arrow keys and a lock-screen scrub all moved the playhead, and the drift check put it back ten seconds later with no explanation. | While tuned and not held, `seek()` is refused with a toast: "You're listening live: everyone hears the same second. Leave the station to scrub or change speed." Held paused, seeking works as always. | e2e "a seek while live is refused" (red on the old build); unit; mutations `live-seek-refused`, `live-locked-not-when-held` |
| A5 | **A saved speed fought the station.** A listener at 1.5× tuned in at 1.5×, drifted, and was pulled back every ten seconds. | The station always plays at 1×, and the speed button is refused while live, with the same reason. An ordinary show afterwards gets the listener's speed back. | unit; mutations `live-plays-at-1x`, `live-rate-button-refused` |
| A6 | **■ Stop while live held the station with an empty player.** It read as a pause. | Emptying the player is leaving. | unit; mutation `live-stop-leaves` |
| A7 | **The same number had two names:** "tuned in live" in the Studio and "listening live" in the phone lines. | "tuned in live" everywhere. | unit; mutation `live-count-one-wording` |

**Considered and left as they are:**
- **Call timestamps are local time; the Studio clock is Pacific.** The station
  runs on its own clock, labelled "PT", because the program's day turns over
  there. A call is a message, and a listener reads when it was said in their
  own time. On the walk (a UTC browser) the two differed by seven hours, which
  is correct for that browser.
- **Report buttons are large on a phone.** They are the 44 px touch floor that
  every tap target here keeps. Folding them into a menu is a design change,
  not a bug.
- **The Studio has no "Rejoin" while tuned and playing.** There is nothing to
  rejoin; it appears only while held.

No console errors or failed requests came from the site on the walk. The
first run's CORS and `/mirror` 404 came from the walk script sending
`X-Forwarded-For` to archive.org. There is no local mirror, so the mirror
could not have served it.

## Why the earlier e2e missed all of this

- **They asserted on the machinery, not on what a listener sees.**
  "Messages arrive in under 2 s" is true while the label on them is wrong.
  "Two clients are within 1 s" is true while pausing throws you out.
- **Nobody reloaded.** Four of the six bugs, and the first-visit row bug, only
  show after a refresh.
- **A check that passes for the wrong reason.** "The library show changed the
  element's `src`" passed on a phone that never started the show, because the
  reload re-primed the element. `live-qa.spec.ts` asserts the other show is
  playing.
- **Two unit-test harnesses hid their subject.**
  - The fake playhead kept advancing through a pause, so "resume jumps to
    live" passed without the jump.
  - jsdom's load algorithm reset `playbackRate`, and a speed set outside `act`
    applied after the station started, so "plays at 1×" passed without the
    fix. Mutations `live-resume-jumps-to-live` and `live-plays-at-1x` survived
    until both harnesses were fixed. See `docs/disconnected-checks.md`.
