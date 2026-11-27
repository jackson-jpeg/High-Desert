# High Desert UI plan: the same world, done with craft

Asked by Jackson through the lead, 2026-11-27: keep the looks we have (Win98's
desktop, taskbar, Start menu, the ON THE AIR strip, Phone Lines in Notepad,
Night's radio-at-night feel) and make them kick a lot more ass. **Not a
restyle.** This builds on `docs/redesign-2026-10-12/` (which chose the two
looks and put Live first on a phone) and `docs/looks.md` (how a look is
chosen and where its CSS lives). Nothing here changes the looks' rules:
Win98 stays the default and what crawlers see, every rule stays under
`html[data-look]`, colours stay `--hd-*` tokens, no em dashes, no new
third-party anything.

**How it was walked.** Every screen in both looks at 390 x 844 (an iPhone)
and 1440 x 900, on production, from a fresh profile, with the stats writes
answered in the page so nothing was counted (`/root/scratch/hd-ui/shoot.mjs`):
welcome, Library (list, Dial, Explore), Live, Phone Lines, Stats, Request
Line, `/shows`, a year, a show, a guest, a topic, `/topics`, Tonight, Privacy,
the 404, and the Start menu (Win98) / More sheet (Night). The **before** set
is in the Mac's `~/Downloads/highdesert-ui-plan/before/`; each push adds its
own `push-N/` folder of before and after at 390.

## Status (2026-11-27)

Pushes 1, 1b, 2, 3, 4 and 5 are live as `4bc82eb` (deployed 2026-11-27
09:2x UTC). Before and after at 390 for each are in the Mac's
`~/Downloads/highdesert-ui-plan/push-N/`. One change after review: the era
dial is on Live only, not in the Library's station card (at 1280 x 720 it
pushed the list's first row off the screen; `uiplan-library-no-dial`).
Handoff: `docs/handoff-2026-11-27-ui-plan.md`.

Later the same day: push 2's Win98 half of Phone Lines (a call's line lamp
in Notepad) had not been built; it is live as `cb5c734` and `cb637f8`.

## What makes it feel flat today

Jackson's list, each confirmed in the shots, plus what the walk found:

1. **The Library list reads grey on grey.** Night: dim grey titles on
   navy-grey cards on a navy page; the year, programme and guest are three
   more greys. Win98 on a desktop: a white ListView, but every column the
   same weight, and the two-line date column reads as noise. Nothing says
   *which era* a show is from.
2. **A long load with blank rows.** On a fresh profile the seed lands in about
   a second, but the screen until then is grey bars, and on a reload after
   using the Dial the boot screen **never left** (found and fixed tonight,
   below). Waiting has no character: it should feel like tuning in.
3. **The season's particles sit over the text.** Win98 draws SeasonSky at
   z-index 45, *over* the windows (it was meant as Win98 desktop snow), so
   leaves and now snow drift across titles, buttons and the Phone Lines.
4. **Category chips cut off at the edge** at 390 ("Psychology & Cons", and
   Night's "Speci" under the List / Dial switch): a row that scrolls, with no
   sign that it does.
5. **The ON THE AIR NOW strip undersells the radio.** A flat black bar with
   green text, the same on every page, saying the least exciting thing on the
   site in the smallest type. It is the station's front door on every screen
   and it should glow like a lit dial.
6. **The desert is missing.** Win98's desktop is a flat navy (teal outside a
   season); the welcome, show and guest pages float as grey windows on it.
   The name of the site is a place, and the place is never shown.
7. **Live is a form, not a radio.** The hero is correct (one Listen button, on
   purpose: `docs/funnel.md`), but nothing on it looks like a radio set: no
   dial, no needle, no lit glass, no warmth. The progress bar is a Win98
   progress bar.
8. **The Start menu is a list of links.** It is the most Win98 thing on the
   site and it does nothing a tab does not.
9. **Guests are blue links.** The best thing in the archive (who called in,
   who was on) has no face.
10. **The Dial's static and the Library are two different products.** The
    Dial is the most radio-like screen and it has the least care: flat blue
    bars, a meter that reads 0% under the needle.

## Found while shooting (fixed tonight, before any UI work)

- **A reload of the Library after using the Dial stuck under the boot screen
  for good**, in both looks, on production. `useLibraryView` read
  sessionStorage during render, so the client's first render (Dial) differed
  from the server's (List): React error #418, the document rendered again,
  and a fresh `#app-loading` the boot script (which dismisses once) never hid.
  Fixed in `19c434a`: the view is List on first render and the stored mode
  after mount, and `useBootScreenGuard` hides any boot screen React draws
  again after the script dismissed it, so a future hydration error cannot do
  this again. This is probably part of the "long load" Jackson saw.
- **The weekly mutation run could not finish** (35 of 1,337 in 5.5 hours in
  heavy's low lane). Jackson approved the normal lane (Inbox f27603c8); in
  `a8d7484`.

## Page by page

For each: **the screenshot moment** (the one change that would make someone
screenshot it), then the craft fixes. W = Win98, N = Night.

### The shell: desktop, taskbar, the ON THE AIR strip (every app page)

- **Screenshot moment: the desert night behind the windows.** W: the flat
  navy becomes a night over the Mojave, drawn in the page (SVG and CSS, no
  image request): a deep gradient sky, a still field of stars, a low moon, and
  the black ridgeline of the Spring Mountains with one red tower light
  blinking slowly (Pahrump's horizon). Windows sit on it like a 1998 desktop
  wallpaper. N: the same ridgeline under its existing starfield, so both looks
  share one horizon.
- **The ON THE AIR strip becomes a lit tuning display**: phosphor text with
  a real glow, a scanline and grain texture, a soft curved-glass vignette, an
  ON AIR lamp that breathes, and a slow marquee that carries the whole line
  (show, guest, year, "N tuned in"), held still with reduced motion. W keeps
  its green-on-black Winamp LCD; N goes amber, the look's accent.
- The season never covers text: W's SeasonSky moves behind the windows
  (z-index 0, on the desktop with the stars), as Night's already is.
- Taskbar: a pressed-in Start button with the logo, tray clock that ticks,
  the online count as a tiny signal icon with a tooltip.

### Library (list)

- **Screenshot moment: era colours.** Every year has its colour, from the
  amber of early-90s Coast to Coast to the cold blue of Dark Matter (2013 to
  2015), carried by the date, the year header band and a 3 px edge on the
  row. Scrolling the list becomes a walk through the decades; the year
  scrubber shows the same bands.
- Contrast: titles at full ink and a weight above the rest; programme as a
  small-caps tag; the date in the era colour; guest in the green the site
  already uses for people; plays and length dim and right-aligned. Night's
  cards get a lifted surface (a hair lighter than the page, a top highlight)
  instead of grey-on-grey.
- Chips: the row scrolls with a fade at the edge and a nudge of the next
  chip visible, never a word cut in half; the show tabs and the List / Dial
  switch get their own line on a phone.
- Loading: no grey bars. The list area shows the dial's static with
  "Tuning in... 1,412 shows" in phosphor until the rows land, then the rows
  fade in top down. A real progress line, not a skeleton.
- The ON AIR welcome window on a desktop (StationWelcome) gets the lit-glass
  treatment of Live.

### Library (Dial)

- **Screenshot moment: a real dial face.** A backlit cream-and-brass AM dial
  with years for frequencies, a red needle with a soft shadow, the station
  numbers in the dial's own type, and the static behind glass. W keeps the
  window chrome around it; N puts it on the night.
- The signal meter becomes a needle VU (it reads 0% today while tuned to a
  show); Lock / Play / Scan as radio push buttons; the frequency in a
  seven-segment phosphor readout.

### Live (the front door: 58% of plays)

- **Screenshot moment: a radio set for Now Playing.** The hero becomes the
  face of a set: the show title on lit glass, a dial strip under it with the
  needle at the show's year, a VU that moves while you listen (the meters
  already work in both looks, `src/audio/levels.ts`), and the one big
  **Listen live** button as the set's main switch. Still one button, still
  first on a phone (`docs/funnel.md`); only its looks change.
- Phosphor glow and real CRT texture on the station clock and ON AIR sign
  (scanlines, a little bloom, no flicker).
- The progress bar becomes a tuning band with a moving marker; "Time left"
  in the readout.
- Phone Lines: W's Notepad stays Notepad, but a call gets a tiny line-number
  lamp; N's lines get the call-slip treatment below.

### Phone Lines (`/live?lines=1`, Notepad)

- **Screenshot moment: the switchboard.** A row of line lamps at the top
  (lines 1 to 6) that light as people call; your own line glows.
- Archive moments and station notices as typed cards with a red rubber-stamp
  header ("FROM THE ARCHIVE"), still never presented as a caller.

### Show pages

- **Screenshot moment: the show's era and its tape.** A header band in the
  show's era colour with the date as a big stamped label, and the Play button
  as a cassette-deck play key; the native audio stays (it works without
  JavaScript).
- Guests as call-in slips (below), topics as tags on a cork strip; the
  "About this show" text set at a reading width with real leading.

### Guest pages

- **Screenshot moment: guests as late-night call-in slips.** A guest's card is
  a pink "While You Were Out"-style call slip: name typed in, "re:" their
  best-known subject, the count of nights they were on, first and last call,
  a "Line" number, a hand-ticked box for the station. Used on guest pages,
  show pages and the Library's guest sheet.
- The list of their shows becomes a call log: date, the era colour, title.

### Topics, `/topics`, `/shows`, `/shows/<year>`, Tonight

- `/shows`: **the decades as a shelf of tapes**, one spine per year in its
  era colour with the count; a year page lists its shows as a tape's J-card.
- `/topics`: topic cards with a small pixel icon each (Area 51, Mel's Hole,
  remote viewing...), a count, and the era range.
- Tonight: the station's log as a printed program guide, a grid of the
  night's hours, the show on the air lit. Called a program guide on screen;
  no real magazine's name or look (Jackson, 2026-11-27).

### Request Line

- **Screenshot moment: the request board.** Nominations as slips pinned on a
  board, votes as tally marks, the leader's slip lit, the countdown to 6 PM
  Pacific as a flip clock.

### Stats

- **Screenshot moment: the station's logbook.** "15 people are in the desert,
  5 have the radio on" set big in phosphor with a live dot; On Air as a meter
  bank; traffic charts in the era-colour palette; records as brass plaques.

### Welcome, 404, Privacy

- Welcome (W): the dialog sits on the desert night; "Enter the archive" and
  "tune in live" become two real buttons, the second lit. N: the horizon.
- 404 ("Signal Lost"): static and a needle sweeping for a station, with the
  way back.

### The Start menu (W) and More (N)

- **Screenshot moment: Start as a real program launcher.** Programs with
  submenus that do things: **Tonight's shows** (the day's log, click to tune),
  **Recent** (your last five), **Guests** (the top 20, A to Z), **By year**
  (1992 to 2015 in era colours), **Request Line**, **Phone Lines**, Settings
  (Display, **Sounds**), Run..., Shut Down (keeps its joke). Keyboard
  navigable as Windows was: arrows, Enter, first letters.
- **Sound on hover and click, off by default.** A Win98 click, a soft relay
  tick on hover, the dial's tune blip, the Start menu's open. One switch:
  Start > Settings > Sounds (W) and More > Sounds (N), stored per browser,
  off unless turned on, never on a phone by default, nothing before a tap.
  Made in the browser with Web Audio (the startup sound already is), no new
  files.

## The pushes, by impact

Each push: its tests and mutations, lint, typecheck, the suite, a build,
check:csp and check:seo on the build, `deploy.sh`, both checks on
production, and before/after at 390 in both looks into
`~/Downloads/highdesert-ui-plan/push-N/` on the Mac. Off peak for the heavy
parts (weekdays 13:00 to 19:00 UTC is peak).

1. **The night behind the windows** (every page, both looks). The desert
   night (W), the shared horizon (N), the lit ON THE AIR strip with the
   marquee, the season behind the windows, chips that scroll without cutting
   words. Plus tonight's boot screen fix. *Biggest change per line of code:
   every screen is different.*
2. **Live as a radio set.** The Now Playing set with the dial strip and VU,
   CRT texture on the clock and ON AIR, the tuning band, the switchboard
   lamps on Phone Lines. *The front door, 58% of plays.*
3. **Era colours and the Library's craft.** The year palette (rows, headers,
   scrubber, show pages, `/shows`), Library contrast in both looks, the
   tuning-in loader in place of grey bars, the Dial's dial face.
4. **Guests and the call slips.** Call-in slips on guest pages, show pages
   and the guest sheet; the call log; topics' cards; the request board.
5. **Start and sound.** The Start menu as a launcher with real submenus, the
   sounds and their switch (off by default), Night's More to match; Stats as
   the logbook, the 404 static.

## Rules every push keeps

- Motion: nothing moves with `prefers-reduced-motion`, nothing blinks faster
  than once a second (the photosensitivity rule from Halloween's bats), the
  marquee pauses on hover and focus, nothing animates while the tab is hidden.
- Contrast: AA on every text (`docs/stats-audit.md`'s ramp; Win98's
  ratios are read from the stylesheets in tests). Glow is decoration on text
  that already passes without it.
- One tap to tune in stays one tap, in the same place, on a phone's Live.
- No image requests for decoration: SVG and CSS in the page. The CSP stays as
  it is.
- Server pages (show, guest, topic, shows) stay server HTML that works
  without JavaScript.
- Each new piece has a test that observes it and a mutation that proves the
  test notices (`docs/disconnected-checks.md`).
