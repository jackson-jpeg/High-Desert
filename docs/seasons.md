# Holiday seasons (2026-10-29)

Jackson asked for holiday theming two days before Halloween: Halloween now,
Thanksgiving from 10 days before it, then Christmas and winter from the day
after Thanksgiving.

## When

`src/lib/season/season.ts`, `seasonOn(year, month, day)`:

| Season | From | To | 2026 |
|---|---|---|---|
| `halloween` | 15 October | 1 November | 15 Oct to 1 Nov |
| `thanksgiving` | 10 days before Thanksgiving (the fourth Thursday of November) | Thanksgiving | 16 to 26 Nov |
| `winter` | the day after Thanksgiving | 6 January (Twelfth Night) | 27 Nov to 6 Jan 2027 |

The site uses the visitor's own date; the station uses the Pacific station
day (`seasonOfDay`).

## How the page knows

`SEASON_SCRIPT` runs in the root layout's `<head>`, before first paint, and
sets `<html data-season>`. It inlines `seasonOn`'s own source, so there is
one definition; `seasonOn` must therefore call nothing outside itself.
`<html>` carries `suppressHydrationWarning` for that one attribute.
`useSeason()` reads it on the client (null on the server and through
hydration).

**Preview:** add `?season=halloween`, `?season=thanksgiving`,
`?season=winter` or `?season=off` to any page's URL.

## What changes

- **Win98:** the title bars sweep from the season's start colour to its end
  colour (`--hd-w98-title-start`, `--hd-w98-title-end`), and the desktop
  (`--hd-w98-teal`) turns the season's dark. Halloween: dusk purple to
  pumpkin. Thanksgiving: bark to harvest. Winter: holly red to pine green on
  a snowy night blue. The chrome's white title text is 5:1 or better on
  every end colour.
- **Night:** desert amber (`--hd-amber`) becomes pumpkin orange, harvest
  orange or ice blue: every amber heading, accent and focus ring follows.
  6.6:1 or better on the raised surface (amber is 7.4:1).
- **Halloween is a still picture** (revised the same day). Flying bats were
  distracting, and a flap near 3 a second sits close to the line for
  photosensitivity, so Halloween draws nothing that moves. `HalloweenScene`
  shows 90s pixel art (`src/lib/season/pixel-art.ts`, text grids drawn as
  crisp SVG): a dithered harvest moon with a bat across it and two off its
  edge, and a jack-o'-lantern. In Win98 they sit on the dusk desktop behind
  every window (top right and bottom left), and the taskbar tray gets a
  16 x 16 pumpkin beside the clock. Night shows no scene: its glass covers
  the whole screen, so the moon could not be seen or sat behind buttons.
  The status bar's Ghost to Ghost badge carries the pixel pumpkin in both
  looks.
- **Thanksgiving and winter:** `SeasonSky`, a full-screen canvas that never
  takes a tap. Leaves fall at Thanksgiving, snow falls in winter. In Night it sits behind the glass with the
  starfield. In Win98 the windows cover the desktop, so it drifts over them,
  a third as many, like the desktop snow programs of the day. Nothing is
  drawn when the visitor asks for reduced motion, or while the tab is hidden.
- **The status bar** (desktop): Halloween keeps its Ghost to Ghost badge,
  now for the whole season and with the pixel pumpkin; Thanksgiving says "🦃 Happy Thanksgiving", winter
  "❄ Happy holidays".
- **The station:** a holiday show (`showSeason`: Ghost to Ghost or
  Halloween, Thanksgiving, Christmas, New Year's or the Millennium in the
  title) is a fan favorite only in its own season. It always airs on its own
  date. The simulation that found this had a Christmas Eve show slated for
  Halloween.

Colours are palette tokens in `src/app/globals.css` (`--hd-season-*`), all
the rules are in `src/styles/seasons.css`, and the canvas uses rgba tints of
the same colours (canvas cannot read `var()`).

## Tests and mutations

- `src/lib/season/__tests__/season.test.ts`: the windows on several years'
  calendars, Thanksgiving the fourth Thursday from 1990 to 2100, the head
  script run for real for every day of 2026 and 2027 and held to `seasonOn`,
  the preview parameter, and the stylesheet's rules.
- `src/components/desktop/__tests__/season-shell.test.tsx`: the real
  DesktopShell, SeasonSky and StatusBar under each season, drawing into a
  recording canvas: snow and leaves counted, a third in Win98, nothing
  with reduced motion, stopped while hidden, Halloween drawing no frame at
  all, the greeting and its pixel pumpkin; a no-season control.
- `src/components/desktop/__tests__/halloween-scene.test.tsx`: the moon and
  the pumpkin drawn crisp at Halloween only, no frame requested and no
  animation in the rules, Night hiding the scene, the sprites' pixels and
  colours. `taskbar.test.tsx`: the tray pumpkin before the clock.
- Mutations: `season-*`, `halloween-*`, `live-season-favorites`.

## The schedule's variety (same day)

Listeners complained that the same shows played on back-to-back days. They
did: 2013-10-28 (Jason Martell) aired as a fan favorite on 27 October and
again as 28 October's on-this-date broadcast; 2010-10-29 aired on 21 and
29 October. Fan favorites looked back 14 days and never ahead. Now
(`buildDay`, `src/lib/live/schedule.ts`):

- the repeat window is 30 days, the same as the Request Line's "played
  recently";
- a favorite whose own date comes up in the next 30 days is held for it;
- a favorite whose guest was on today or in the 2 days before waits behind
  one whose guest was not (Richard C. Hoagland has 67 shows);
- holiday shows only in season (above).

Days already frozen stay as they are. The first day built under the new
rules is the first one not frozen at deploy.

Simulated on production's plays and frozen days for the 40 days from
2026-10-30: shows heard twice went from 163 to 37, and none of those within
30 days; a guest on two days running went from 20 to 9, all of those
on-this-date broadcasts, which keep their dates.

Mutations: `live-hold-for-date`, `live-guest-spacing`, `live-guest-history`;
`live-repeat-rule` re-anchored.
