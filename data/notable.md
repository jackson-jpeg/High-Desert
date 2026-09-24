# Notable episodes

The "Notable" badge and filter in the library, and the Archive card's
**Notable** count on /stats, come from this list. It is curated by hand, and
**every entry cites a public source** that dates the event to the exact broadcast.
The machine-readable copy is `data/notable.json`; `src/db/__tests__/notable.test.ts`
holds the two, the seed (`aiNotable: true`) and the in-browser refresh to the same
set.

## Why this list exists

The flag was never populated. No commit of `public/seed/library.json` ever carried
`aiNotable`, `scripts/categorize-library.py` never wrote it, and its only writer was a
runtime `/api/categorize` route that returned 401 in production and was deleted in
`c9e5087`. So the Archive card read 0 and the badge never appeared (Part 1C,
`docs/stats-audit.md`).

## Rules for adding one

- The seed row's **air date must match** the documented event. A title that fits but a
  date that disagrees with the sources is left out (see "Considered and excluded").
- Cite something a reader can check: an encyclopedia article, contemporary press, or
  the network's own show page. Fan listings that only show an episode *exists* do not
  make it a landmark.
- Add it to `data/notable.json` **and** this table, set `aiNotable: true` on the seed row,
  and bump `NOTABLE_VERSION` in `src/db/catalog-flags.ts` so returning visitors pick it up.

## The list

| Air date | Episode | Why | Source |
|---|---|---|---|
| 1995-12-07 | Coast to Coast AM - Remote Viewing | Major Ed Dames' first appearance, shortly after the CIA disclosed its Cold War remote-viewing program; he became one of the show's most recurring and controversial guests. | [Art Bell: Somewhere in Time (Coast to Coast AM, 2009-04-11)](https://www.coasttocoastam.com/alternate/amp/show/2009-04-11-art/) |
| 1996-10-18 | Coast to Coast AM - Exorcism | Father Malachi Martin's first-ever appearance: a five-hour conversation on exorcism and possession that began his run of widely replayed shows. | [Malachi Martin's First Appearance — Coast to Coast AM](https://www.coasttocoastam.com/show/exorcisms-demonic-possession/) |
| 1996-11-14 | Coast to Coast AM - Remote Viewing the Hale-Bopp Anomaly | The broadcast where Chuck Shramek's 'Saturn-like object' photo and Courtney Brown's remote-viewing claim launched the Hale-Bopp companion rumour later tied to the Heaven's Gate suicides. | [Exposing PseudoAstronomy — Chuck Shramek (Stuart Robbins); see also Wikipedia, Comet Hale–Bopp § UFO claims](https://pseudoastro.wordpress.com/tag/chuck-shramek/) |
| 1997-02-21 | Coast to Coast AM - Contact and Disclosure with Dr. Steven Greer, Mel Waters First Appearance | Mel Waters' first call describing 'Mel's Hole', the bottomless-pit story that became one of the show's most famous legends. | [Mel's Hole — Wikipedia](https://en.wikipedia.org/wiki/Mel%27s_Hole) |
| 1997-02-24 | Coast to Coast AM - Flying Sickness with Diana Fairechild, Mel Waters Update | Mel Waters' second appearance (February 24, 1997), continuing the Mel's Hole story. | [Mel's Hole — Wikipedia](https://en.wikipedia.org/wiki/Mel%27s_Hole) |
| 1997-09-11 | Coast to Coast AM - Open Lines with Area 51 Employees | The frantic 'Area 51 employee' call, during which the satellite feed dropped and the broadcast went silent — the most retold night in the show's history. | [The Truth Was Out There: On the Legacy of Art Bell — Los Angeles Review of Books](https://lareviewofbooks.org/article/the-truth-was-out-there-on-the-legacy-of-art-bell/) |
| 2000-04-26 | Coast to Coast AM - Art's Farewell | Art Bell's announced farewell broadcast of April 26, 2000, the second of his retirements. | [Radio talk-show host Art Bell says he plans to retire again — The Seattle Times, 2000-04-02](https://archive.seattletimes.com/archive/20000402/4013150/radio-talk-show-host-art-bell-says-he-plans-to-retire-again) |
| 2002-12-31 | Coast to Coast AM - Art's Farewell Show with Predictions | Art Bell's last official show as weekday host of Coast to Coast AM, before George Noory took over on January 1, 2003. | [Art's Farewell Show — Coast to Coast AM](https://www.coasttocoastam.com/show/2002-12-31-show/) |
| 2013-09-16 | Special - Fate of the Universe | The premiere of Art Bell's Dark Matter on SiriusXM, with Michio Kaku as the first guest. | [Art Bell's Dark Matter — Wikipedia](https://en.wikipedia.org/wiki/Art_Bell%27s_Dark_Matter) |

## Considered and excluded

- **1998-10-12, "Art's Retirement Announcement"** — sources date the announcement to
  Oct 13 (LA Review of Books) or Wed Oct 14, 4 a.m. MDT (Deseret News); the seed date
  matches neither.
- **Mel Waters, 2000-04-24 and 2002-01-29** — Wikipedia confirms later appearances by
  year only, not by date.
- **1997-03-13, Phoenix Lights** — the one account of Bell's callers that night
  (Phoenix New Times) could not be retrieved to verify.
- **1999-06-16, "Goodbye Terence McKenna"** — sources disagree between June 16 and
  July 16, 1999, and the seed lists a different guest.
- **1996-12-06 (Strieber/Shramek), 1992-12-12 (Lear/Lazar)** — no dated source calling
  them landmarks; only listings that they aired.
- **Ghost to Ghost** — an annual tradition; no single year is documented as the landmark.
