# Catalog guest fields that repeated the title

**2026-10-01.** 136 rows of `public/seed/library.json` carried their own
subject in `guestName`, so every surface read it twice: On Air showed
"Open Lines with Area 51 Employees" over "Sep 11, 1997 · Open Lines with
Area 51 Employees Call-in". Those fields were removed from the seed. Nothing
else on any row changed (the commit's diff is 136 deleted `guestName` lines).

## The rule

`guestRepeatsTitle()` in `src/lib/library/guest.ts`. Both must hold:

1. the field names a programme, not a person (Open Lines, Ghost to Ghost,
   Predictions, Area 51, Time Traveler, "hour 1", "Art's", and so on);
2. its words and the title's subject (the part after " - ") are one inside
   the other, plurals folded.

A person whose name is the title ("Coast to Coast AM - Richard C. Hoagland")
is a real guest and keeps the field: guest profiles and the guest filter read
it. 281 such rows meet (2) but not (1), and were left alone.

## Libraries seeded before this

`reconcileLibrary()` only adds rows and never rewrites one (CLAUDE.md, "Data
safety"), so a visitor seeded before 2026-10-01 keeps the old fields in
IndexedDB. Every surface that shows a guest reads it through `shownGuest()`,
which hides exactly what the rule matches. No unattended write to anyone's
library was added.

## Re-running

```bash
node scripts/clean-guest-repeats.mjs           # lists matches (none now)
node scripts/clean-guest-repeats.mjs --write   # removes them from the seed
```

`src/lib/library/__tests__/guest.test.ts` fails if a matching field comes back
into the seed, and if any guest still in the seed would be hidden.

## Moved to the topic (2026-10-09)

Ten guest fields described the programme without repeating the title, so the
rule above left them. Jackson's call: move each into the row's `topic` and
leave the guest empty. `scripts/move-guest-topics.mjs --write` did it, from the
list `MOVED_TO_TOPIC` in `src/lib/library/guest.ts`:

- the guest, less the file's hour note ("(hour 1)", "(1st hour)"), became `topic`;
- the old `topic`, lowercased, joined `aiTags` unless it was there already;
- `guestName` was removed. Nothing else on the row changed.

SEED_VERSION went to `2026-10-09-a`. A library seeded earlier keeps its old
row (reconcile only adds, never rewrites), so it keeps the old guest and the
old topic; `shownGuest()` hides that guest by exact `fileHash` and value, so
no surface shows it. To undo one: put `"guestName": "<old guest>"` back, set
`topic` to the old topic, drop the added tag, and remove its entry from
`MOVED_TO_TOPIC`.

| Air date | Old guest field | New topic | Old topic | Added to aiTags |
|---|---|---|---|---|
| 1997-06-30 | News, Commentary, Open Lines (hour 1) | News, Commentary, Open Lines | News and Open Lines | news and open lines |
| 1997-08-11 | UPS strike (hour 1) | UPS strike | UPS Strike and Labor Issues | ups strike and labor issues |
| 1997-08-18 | News, Commentary, Open Lines (hour 1) | News, Commentary, Open Lines | News and Open Lines | news and open lines |
| 1997-11-26 | News, Commentary, Open Lines (hour 1) | News, Commentary, Open Lines | Open Lines | (already a tag) |
| 1997-12-02 | News, Commentary, Open Lines (hour 1) | News, Commentary, Open Lines | Open Lines | (already a tag) |
| 1997-12-31 | New Year's Predictions Night 2 (1st hour) | New Year's Predictions Night 2 | New Year's Predictions | new year's predictions |
| 1999-05-27 | Art's Secret | Art's Secret | Internet Defamation | internet defamation |
| 2001-02-28 | Ghost To Ghost Stories | Ghost To Ghost Stories | Ghost Stories from Listeners | ghost stories from listeners |
| 2001-08-31 | Area 51, Earthquakes, and Crop Circles | Area 51, Earthquakes, and Crop Circles | Area 51 Earthquakes Crop Circles | area 51 earthquakes crop circles |
| 2003-12-31 | Annual Predictions Show | Annual Predictions Show | New Year Predictions | new year predictions |

## The 136 fields removed

The original value of each, to restore one: put `"guestName": "<value>"` back
on the row with that `fileHash`.

| Air date | Title | Removed guest field | fileHash |
|---|---|---|---|
| 1993-10-30 | Coast to Coast AM - Ghost to Ghost 1993 | Ghost to Ghost 1993 | `archive:ultimate-ultimate-art-bell-collection:1993-10-30 - Coast to Coast AM with Art Bell - Ghost to Ghost 1993.mp3` |
| 1994-10-28 | Coast to Coast AM - Ghost to Ghost 1994 | Ghost To Ghost 1994 | `archive:ultimate-ultimate-art-bell-collection:1994-10-28 - Coast to Coast AM with Art Bell - Ghost To Ghost 1994.mp3` |
| 1994-11-10 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1994-11-10 - Coast to Coast AM with Art Bell -  Open Lines.mp3` |
| 1995-06-01 | Coast to Coast AM - Open Lines | Open Lines. Bob Dole's Attacks on Hollywood | `archive:ultimate-ultimate-art-bell-collection:1995-06-01 - Coast to Coast AM with Art Bell -  Open Lines. Bob Dole's Attacks on Hollywood.mp3` |
| 1995-06-09 | Coast to Coast AM - Oklahoma City Bombing | Oklahoma City Bombings | `archive:ultimate-ultimate-art-bell-collection:1995-06-09 - Coast to Coast AM with Art Bell - Oklahoma City Bombings.mp3` |
| 1995-07-04 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1995-07-04 - Coast to Coast AM with Art Bell -  Open Lines - Unabomber, other topics.mp3` |
| 1995-07-17 | Coast to Coast AM - Open Lines on Alien Autopsy and Weather | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1995-07-17 - Coast to Coast AM with Art Bell - Open Lines - Alien Autopsy - Weather.mp3` |
| 1995-07-21 | Coast to Coast AM - Ladies Room Lines | Ladies Room Lines | `archive:ultimate-ultimate-art-bell-collection:1995-07-21 - Coast to Coast AM with Art Bell - Ladies Room Lines - Open Lines.mp3` |
| 1995-08-14 | Coast to Coast AM - Open Lines on Smoking Cessation | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1995-08-14 - Coast to Coast AM with Art Bell - Open Lines - Stop Smoking.mp3` |
| 1995-08-22 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1995-08-22 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1995-08-23 | Coast to Coast AM - Open Lines: O.J. Simpson and Windows 95 | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1995-08-23 - Coast to Coast AM with Art Bell - Open Lines - OJ - Windows 95.mp3` |
| 1995-08-24 | Coast to Coast AM - Open Lines: O.J. Simpson and Windows 95 | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1995-08-24 - Coast to Coast AM with Art Bell -  Open Lines - OJ - Windows 95.mp3` |
| 1995-10-30 | Coast to Coast AM - Ghost to Ghost 1995 | Ghost to Ghost 1995 | `archive:ultimate-ultimate-art-bell-collection:1995-10-30 - Coast to Coast AM with Art Bell - Ghost to Ghost 1995.mp3` |
| 1995-11-02 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1995-11-02 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1995-12-05 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1995-12-05 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1995-12-06 | Coast to Coast AM - Full Moon Open Lines | Full Moon Open Lines | `archive:ultimate-ultimate-art-bell-collection:1995-12-06 - Coast to Coast AM with Art Bell - Full Moon Open Lines.mp3` |
| 1996-01-19 | Coast to Coast AM - Alien and Immortal Open Lines | Alien and Immortal Open Lines | `archive:ultimate-ultimate-art-bell-collection:1996-01-19 - Coast to Coast AM with Art Bell - Alien and Immortal Open Lines.mp3` |
| 1996-03-27 | Coast to Coast AM - Open Lines on the Freemen Standoff | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1996-03-27 - Coast to Coast AM with Art Bell - Open Lines - Freemen.mp3` |
| 1996-04-03 | Coast to Coast AM - Open Lines on Roswell Fragments & The Quickening | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1996-04-03 - Coast to Coast AM with Art Bell - Open Lines - Roswell Fragments - The Quickening.mp3` |
| 1996-04-04 | Coast to Coast AM - Open Lines on Unabomber, North Korea & Freemen | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1996-04-04 - Coast to Coast AM with Art Bell - Open Lines - Unabomber, N. Korea, Freemen.mp3` |
| 1996-04-08 | Coast to Coast AM - Open Lines on the Unabomber | Open Lines & Unabomber | `archive:ultimate-ultimate-art-bell-collection:1996-04-08 - Coast to Coast AM with Art Bell - Open Lines & Unabomber.mp3` |
| 1996-04-16 | Coast to Coast AM - Open Lines Bizarre Stories | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1996-04-16 - Coast to Coast AM with Art Bell - Open Lines - Bizarre Stories.mp3` |
| 1996-05-10 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1996-05-10 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1996-07-01 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1996-07-01 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1996-07-04 | Coast to Coast AM - Open Lines Truth or Trash | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1996-07-04 - Coast to Coast AM with Art Bell - Open Lines - Truth or Trash.mp3` |
| 1996-07-09 | Coast to Coast AM - Open Lines: Paranoid People Hotline | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1996-07-09 - Coast to Coast AM with Art Bell -  Open Lines - Paranoid People Hotline -.mp3` |
| 1996-09-09 | Coast to Coast AM - Open Lines on TWA 800, Art's Parts, and Crop Circles | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1996-09-09 - Coast to Coast AM with Art Bell - Open Lines - TWA 800, Arts Parts, Crop Circles.mp3` |
| 1996-10-24 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1996-10-24 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1996-10-30 | Special - Ghost to Ghost 1996 | Ghost to Ghost 1996 | `archive:ultimate-ultimate-art-bell-collection:1996-10-30 - Coast to Coast AM with Art Bell - Ghost to Ghost 1996.mp3` |
| 1997-01-01 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-01-01 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1997-01-20 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-01-20 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1997-01-21 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-01-21 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1997-02-04 | Coast to Coast AM - Open Lines | Open Lines. Steve Forbes, Ma Bell | `archive:ultimate-ultimate-art-bell-collection:1997-02-04 - Coast to Coast AM with Art Bell - Open Lines. Steve Forbes, Ma Bell.mp3` |
| 1997-02-27 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-02-27 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1997-03-04 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-03-04 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1997-03-14 | Coast to Coast AM - Phoenix Lights Follow-up | Phoenix Lights | `archive:ultimate-ultimate-art-bell-collection:1997-03-14 - Coast to Coast AM with Art Bell - Phoenix Lights.mp3` |
| 1997-05-16 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-05-16 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1997-05-21 | Coast to Coast AM - The Phoenix Lights | The Phoenix Lights | `archive:ultimate-ultimate-art-bell-collection:1997-05-21 - Coast to Coast AM with Art Bell - The Phoenix Lights.mp3` |
| 1997-05-26 | Coast to Coast AM - Open Lines and Art's UFO Sighting | Open Lines. Art and Ramona's UFO Sighting #2 | `archive:ultimate-ultimate-art-bell-collection:1997-05-26 - Coast to Coast AM with Art Bell - Open Lines. Art and Ramona's UFO Sighting #2.mp3` |
| 1997-05-29 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-05-29 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1997-06-03 | Coast to Coast AM - Open Lines: Witch Hunt | Open Lines 'Witch Hunt' | `archive:ultimate-ultimate-art-bell-collection:1997-06-03 - Coast to Coast AM with Art Bell - Open Lines 'Witch Hunt'.mp3` |
| 1997-06-19 | Coast to Coast AM - Open Lines: Phoenix Lights | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-06-19 - Coast to Coast AM with Art Bell -  Open Lines - Phoenix Lights.mp3` |
| 1997-07-01 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-07-01 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1997-07-15 | Coast to Coast AM - Open Lines with Time Traveler Hotline | Open Lines with Time Traveler Hotline (hour 1) | `archive:ultimate-ultimate-art-bell-collection:1997-07-15 - Coast to Coast AM with Art Bell - Open Lines with Time Traveler Hotline (hour 1).mp3` |
| 1997-08-08 | Coast to Coast AM - Open Lines on Men in Black and Time Travelers | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-08-08 - Coast to Coast AM with Art Bell - Open Lines - Men in Black, Time Travelers.mp3` |
| 1997-09-09 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-09-09 - Coast to Coast AM with Art Bell - Open Lines.mp3` |
| 1997-09-11 | Coast to Coast AM - Open Lines with Area 51 Employees | Open Lines with Area 51 Employees Call-in | `archive:ultimate-ultimate-art-bell-collection:1997-09-11 - Coast to Coast AM with Art Bell - Open Lines with Area 51 Employees Call-in.mp3` |
| 1997-10-20 | Coast to Coast AM - Art's Egypt Trip | Art's Egypt Trip | `archive:ultimate-ultimate-art-bell-collection:1997-10-20 - Coast to Coast AM with Art Bell - Art's Egypt Trip.mp3` |
| 1997-10-30 | Special - Ghost to Ghost 1997 Night 1 | Ghost To Ghost 1997 Night 1 | `archive:ultimate-ultimate-art-bell-collection:1997-10-30 - Coast to Coast AM with Art Bell - Ghost To Ghost 1997 Night 1.mp3` |
| 1997-10-31 | Special - Ghost to Ghost 1997 Night 2 | Ghost To Ghost 1997 Night 2 | `archive:ultimate-ultimate-art-bell-collection:1997-10-31 - Coast to Coast AM with Art Bell - Ghost To Ghost 1997 Night 2.mp3` |
| 1997-12-24 | Coast to Coast AM - Open Lines Christmas Eve with Ramona | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1997-12-24 - Coast to Coast AM with Art Bell - Open Lines - Ramona - Christmas Eve.mp3` |
| 1998-01-20 | Coast to Coast AM - Open Lines: Phoenix Lights Testimonies | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1998-01-20 - Coast to Coast AM with Art Bell - Open Lines - new Phoenix Lights testimonies (hour 1).mp3` |
| 1998-01-21 | Coast to Coast AM - Open Lines: Lewinsky Scandal | News, Open Lines, the Lewinsky Scandal (hour 1) | `archive:ultimate-ultimate-art-bell-collection:1998-01-21 - Coast to Coast AM with Art Bell - News, Open Lines, the Lewinsky Scandal (hour 1).mp3` |
| 1998-02-19 | Coast to Coast AM - The Life of Edgar Cayce | The Life of Edgar Cayce | `archive:ultimate-ultimate-art-bell-collection:1998-02-19 - Coast to Coast AM with Art Bell - The Life of Edgar Cayce.mp3` |
| 1998-06-02 | Coast to Coast AM - Open Lines Antichrist Hotline | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1998-06-02 - Coast to Coast AM with Art Bell -  Open Lines - Antichrist Hotline.mp3` |
| 1998-07-29 | Coast to Coast AM - Time Traveler Line | Time Traveler Line | `archive:ultimate-ultimate-art-bell-collection:1998-07-29 - Coast to Coast AM with Art Bell - Time Traveler Line.mp3` |
| 1998-08-07 | Coast to Coast AM - Area 51 Government Employee Lines | Area 51 Government Employee Lines only 1hr | `archive:ultimate-ultimate-art-bell-collection:1998-08-07 - Coast to Coast AM with Art Bell - Area 51 Government Employee Lines only 1hr.mp3` |
| 1998-10-12 | Coast to Coast AM - Open Lines & Art's Retirement Announcement | Open Lines. Art's Retirement Announcement | `archive:ultimate-ultimate-art-bell-collection:1998-10-12 - Coast to Coast AM with Art Bell - Open Lines. Art's Retirement Announcement.mp3` |
| 1998-10-23 | Coast to Coast AM - Art's Statement on Sudden Resignation | Art's statement on sudden resignation | `archive:ultimate-ultimate-art-bell-collection:1998-10-23 - Coast to Coast AM with Art Bell - Art's statement on sudden resignation.mp3` |
| 1998-10-30 | Coast to Coast AM - Ghost to Ghost 1998 (Partial) | Ghost to Ghost 1998 Ghost Stories (partial) | `archive:ultimate-ultimate-art-bell-collection:1998-10-30 - Coast to Coast AM with Art Bell - Ghost to Ghost 1998 Ghost Stories (partial).mp3` |
| 1998-10-31 | Coast to Coast AM - Ghost to Ghost 1998 | Ghost to Ghost 1998 | `archive:ultimate-ultimate-art-bell-collection:1998-10-31 - Coast to Coast AM with Art Bell - Ghost to Ghost 1998.mp3` |
| 1998-11-27 | Coast to Coast AM - Ghost to Ghost Special | Ghost to Ghost | `archive:ultimate-ultimate-art-bell-collection:1998-11-27 - Coast to Coast AM with Art Bell - Ghost to Ghost - Open Lines.mp3` |
| 1998-12-30 | Coast to Coast AM - Death Threats, EQ Pegasi Hoax, Weather Control | Death Threats, EQ Pegasi Hoax, Weather Control & Hoagland vs Stephens | `archive:ultimate-ultimate-art-bell-collection:1998-12-30 - Coast to Coast AM with Art Bell - Death Threats, EQ Pegasi Hoax, Weather Control & Hoagland vs Stephens.mp3` |
| 1999-06-10 | Coast to Coast AM - Ghost to Ghost | Ghost to Ghost | `archive:ultimate-ultimate-art-bell-collection:1999-06-10 - Coast to Coast AM with Art Bell - Ghost to Ghost - Open Lines.mp3` |
| 1999-09-14 | Coast to Coast AM - Open Lines Hurricane Floyd | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1999-09-14 - Coast to Coast AM with Art Bell -  Open Lines - Hurricane Floyd (partial).mp3` |
| 1999-09-15 | Coast to Coast AM - Long Call with JC | Long Call with JC | `archive:ultimate-ultimate-art-bell-collection:1999-09-15 - Coast to Coast AM with Art Bell - Long Call with JC.mp3` |
| 1999-10-20 | Coast to Coast AM - Open Lines: Secret Societies | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1999-10-20 - Coast to Coast AM with Art Bell - Open Lines - Secret Societies Hotline.mp3` |
| 1999-12-01 | Coast to Coast AM - Best Sound Clips | Best Sound Clips | `archive:ultimate-ultimate-art-bell-collection:1999-12-00 - Coast to Coast AM with Art Bell -  Best Sound Clips.mp3` |
| 1999-12-15 | Coast to Coast AM - Open Lines on Y2K | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1999-12-15 - Coast to Coast AM with Art Bell -  Open Lines - Y2k.mp3` |
| 1999-12-21 | Coast to Coast AM - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:1999-12-21 - Coast to Coast AM with Art Bell - Open Lines -  show ends early.mp3` |
| 2000-02-23 | Coast to Coast AM - Ghost to Ghost | Ghost to Ghost | `archive:ultimate-ultimate-art-bell-collection:2000-02-23 - Coast to Coast AM with Art Bell - Ghost to Ghost.mp3` |
| 2000-04-25 | Coast to Coast AM - Ghost to Ghost Open Lines | Ghost to Ghost | `archive:ultimate-ultimate-art-bell-collection:2000-04-25 - Coast to Coast AM with Art Bell - Ghost to Ghost - Open Lines.mp3` |
| 2001-03-23 | Coast to Coast AM - Antichrist & Time Traveler Open Lines | Antichrist & Time Traveler Lines | `archive:ultimate-ultimate-art-bell-collection:2001-03-23 - Coast to Coast AM with Art Bell - Antichrist & Time Traveler Lines.mp3` |
| 2001-04-13 | Coast to Coast AM - Ghost to Ghost | Ghost to Ghost AM Friday Night Ghost Tales | `archive:ultimate-ultimate-art-bell-collection:2001-04-13 - Coast to Coast AM with Art Bell - Ghost to Ghost AM Friday Night Ghost Tales.mp3` |
| 2001-04-20 | Coast to Coast AM - Open Lines Truth or Trash | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2001-04-20 - Coast to Coast AM with Art Bell - Open Lines - Truth or Trash - Sarah's NDE.mp3` |
| 2001-06-01 | Coast to Coast AM - Open Lines Truth or Trash | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2001-06-01 - Coast to Coast AM with Art Bell - Open Lines - Truth or Trash.mp3` |
| 2001-09-12 | Coast to Coast AM - Open Lines on 9/11 Aftermath | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2001-09-12 - Coast to Coast AM with Art Bell - Open Lines - Callers Respond and React to 911, Day 2.mp3` |
| 2001-09-13 | Coast to Coast AM - Open Lines on 9/11 Aftermath | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2001-09-13 - Coast to Coast AM with Art Bell - Open Lines - Callers Respond and React to 911, Day 3.mp3` |
| 2001-09-14 | Coast to Coast AM - Open Lines on 9/11 Aftermath | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2001-09-14 - Coast to Coast AM with Art Bell - Open Lines - Callers Respond and React to 911, Day 4.mp3` |
| 2001-09-25 | Coast to Coast AM - Open Lines on War Decision | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2001-09-25 - Coast to Coast AM with Art Bell - Open Lines - To War or Not.mp3` |
| 2001-10-19 | Coast to Coast AM - Open Lines on Mass Consciousness Experiment | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2001-10-19 - Coast to Coast AM with Art Bell - Open Lines - Princeton University Mass Consciousness Experiment.mp3` |
| 2001-10-24 | Coast to Coast AM - Electronic Voice Phenomena | Electronic Voice Phenomena GIS | `archive:ultimate-ultimate-art-bell-collection:2001-10-24 - Coast to Coast AM with Art Bell - Electronic Voice Phenomena GIS.mp3` |
| 2001-10-31 | Coast to Coast AM - Ghost to Ghost 2001 | Ghost to Ghost 2001 | `archive:ultimate-ultimate-art-bell-collection:2001-10-31 - Coast to Coast AM with Art Bell - Ghost to Ghost 2001.mp3` |
| 2001-12-27 | Coast to Coast AM - Predictions for 2002 | Predictions for 2002 | `archive:ultimate-ultimate-art-bell-collection:2001-12-27 - Coast to Coast AM with Art Bell - Predictions for 2002.mp3` |
| 2002-01-11 | Coast to Coast AM - Open Lines: If You Were God | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2002-01-11 - Coast to Coast AM with Art Bell -  Open Lines - If You Were God.mp3` |
| 2002-01-18 | Coast to Coast AM - Bizarre Open Lines | Bizarre Open Lines | `archive:ultimate-ultimate-art-bell-collection:2002-01-18 - Coast to Coast AM with Art Bell - Bizarre Open Lines.mp3` |
| 2002-01-25 | Coast to Coast AM - Open Lines: Monsters | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2002-01-25 - Coast to Coast AM with Art Bell - Open Lines - Monsters.mp3` |
| 2002-02-15 | Coast to Coast AM - Open Lines on Immortals | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2002-02-15 - Coast to Coast AM with Art Bell - Open Lines - Immortals.mp3` |
| 2002-05-24 | Coast to Coast AM - Open Lines: Monsters and Disturbing Entities | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2002-05-24 - Coast to Coast AM with Art Bell -  Open Lines - Monsters and Disturbing Entities.mp3` |
| 2002-12-31 | Coast to Coast AM - Art's Farewell Show with Predictions | Art's Farewell Show | `archive:ultimate-ultimate-art-bell-collection:2002-12-31 - Coast to Coast AM with Art Bell - Art's Farewell Show - Predictions.mp3` |
| 2003-05-30 | Coast to Coast AM - Time Traveler Line | Time Traveler Line | `archive:ultimate-ultimate-art-bell-collection:2003-05-30 - Coast to Coast AM with Art Bell - Time Traveler Line - Open Lines.mp3` |
| 2003-09-05 | Coast to Coast AM - Contact Night | Contact Night | `archive:ultimate-ultimate-art-bell-collection:2003-09-05 - Coast to Coast AM with Art Bell - Contact Night - Open Lines.mp3` |
| 2003-10-31 | Special - Ghost to Ghost AM 2003 | Ghost to Ghost AM 2003 | `archive:ultimate-ultimate-art-bell-collection:2003-10-31 - Coast to Coast AM with Art Bell - Ghost to Ghost AM 2003.mp3` |
| 2003-12-28 | Coast to Coast AM - Annual Predictions Show | Annual Predictions Show | `archive:ultimate-ultimate-art-bell-collection:2003-12-28 - Coast to Coast AM with Art Bell - Annual Predictions Show - Open Lines.mp3` |
| 2004-01-25 | Coast to Coast AM - Open Lines | Art Bell Open Lines | `archive:ultimate-ultimate-art-bell-collection:2004-01-25 - Coast to Coast AM with Art Bell - Art Bell Open Lines.mp3` |
| 2004-05-30 | Coast to Coast AM - Open Lines on End Times | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2004-05-30 - Coast to Coast AM with Art Bell - Open Lines - The End of the World.mp3` |
| 2004-07-04 | Coast to Coast AM - Open Lines Prophet Show | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2004-07-04 - Coast to Coast AM with Art Bell - Open Lines - The Prophet Show.mp3` |
| 2004-08-22 | Coast to Coast AM - Open Lines on Time Travel | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2004-08-22 - Coast to Coast AM with Art Bell - Open Lines - Time Travel.mp3` |
| 2004-10-31 | Special - Ghost to Ghost 2004 | Ghost to Ghost 2004 | `archive:ultimate-ultimate-art-bell-collection:2004-10-31 - Coast to Coast AM with Art Bell - Ghost to Ghost 2004.mp3` |
| 2005-01-02 | Coast to Coast AM - Open Lines on Alien Encounters | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2005-01-02 - Coast to Coast AM with Art Bell - Open Lines - Alien Encounters.mp3` |
| 2005-02-06 | Coast to Coast AM - Open Lines | Amazing Open Lines | `archive:ultimate-ultimate-art-bell-collection:2005-02-06 - Coast to Coast AM with Art Bell - Amazing Open Lines.mp3` |
| 2005-03-27 | Coast to Coast AM - Open Lines on Gas Crisis | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2005-03-27 - Coast to Coast AM with Art Bell - Open Lines - The Coming Gas Crisis.mp3` |
| 2005-10-31 | Special - Ghost to Ghost 2005 | Ghost to Ghost 2005 | `archive:ultimate-ultimate-art-bell-collection:2005-10-31 - Coast to Coast AM with Art Bell - Ghost to Ghost 2005.mp3` |
| 2006-10-31 | Special - Ghost to Ghost 2006 | Ghost to Ghost 2006 | `archive:ultimate-ultimate-art-bell-collection:2006-10-31 - Coast to Coast AM with Art Bell -  Ghost to Ghost 2006.mp3` |
| 2006-11-19 | Coast to Coast AM - Open Lines: Dealin' with the Devil | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2006-11-19 - Coast to Coast AM with Art Bell - Open Lines - Dealin' with the Devil.mp3` |
| 2006-12-22 | Coast to Coast AM - Open Lines: Worst Days | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2006-12-22 - Coast to Coast AM with Art Bell - Open Lines - Worst Days.mp3` |
| 2006-12-30 | Coast to Coast AM - Predictions for 2007 Part 1 | Predictions for 2007 part 1 | `archive:ultimate-ultimate-art-bell-collection:2006-12-30 - Coast to Coast AM with Art Bell - Predictions for 2007 part 1.mp3` |
| 2006-12-31 | Coast to Coast AM - Predictions for 2007 Part 2 | Predictions for 2007 part 2 | `archive:ultimate-ultimate-art-bell-collection:2006-12-31 - Coast to Coast AM with Art Bell - Predictions for 2007 part 2.mp3` |
| 2007-10-31 | Special - Ghost to Ghost 2007 | Ghost to Ghost 2007 | `archive:ultimate-ultimate-art-bell-collection:2007-10-31 - Coast to Coast AM with Art Bell - Ghost to Ghost 2007.mp3` |
| 2007-12-30 | Special - 2008 Predictions Night 1 | 2008 Predictions Night 1 | `archive:ultimate-ultimate-art-bell-collection:2007-12-30 - Coast to Coast AM with Art Bell - 2008 Predictions Night 1.mp3` |
| 2007-12-31 | Special - 2008 Predictions Night 2 | 2008 Predictions Night 2 | `archive:ultimate-ultimate-art-bell-collection:2007-12-31 - Coast to Coast AM with Art Bell - 2008 Predictions Night 2.mp3` |
| 2008-12-30 | Coast to Coast AM - Predictions 2009 Part 1 | Predictions 2009 | `archive:ultimate-ultimate-art-bell-collection:2008-12-30 - Coast to Coast AM with Art Bell -  Predictions 2009 - Part 1.mp3` |
| 2008-12-31 | Coast to Coast AM - Predictions 2009 Part 2 | Predictions 2009 | `archive:ultimate-ultimate-art-bell-collection:2008-12-31 - Coast to Coast AM with Art Bell -  Predictions 2009 - Part 2.mp3` |
| 2009-12-30 | Coast to Coast AM - Predictions for 2010 Part 1 | Predictions 2010 | `archive:ultimate-ultimate-art-bell-collection:2009-12-30 - Coast to Coast AM with Art Bell -  Predictions 2010 - Part 1.mp3` |
| 2009-12-31 | Coast to Coast AM - Predictions 2010 Part 2 | Predictions 2010 | `archive:ultimate-ultimate-art-bell-collection:2009-12-31 - Coast to Coast AM with Art Bell -  Predictions 2010 - Part 2.mp3` |
| 2010-10-31 | Special - Ghost to Ghost 2010 | Ghost to Ghost 2010 | `archive:ultimate-ultimate-art-bell-collection:2010-10-31 - Coast to Coast AM with Art Bell - Ghost to Ghost 2010.mp3` |
| 2013-10-10 | Special - Open Lines | Open Lines | `archive:ultimate-ultimate-art-bell-collection:2013-10-10 - Dark Matter with Art Bell - Open Lines.mp3` |
| 2015-07-24 | Midnight in the Desert - Open Lines | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-07-24 - Art Bell MITD - Open Lines.mp3` |
| 2015-07-31 | Midnight in the Desert - Open Lines: Paranormal Stories | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-07-31 - Art Bell MITD - Open Lines Paranormal Stories.mp3` |
| 2015-08-03 | Midnight in the Desert - Open Lines: Shadow People Stories | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-08-03 - Art Bell MITD - Open Lines Shadow People Stories.mp3` |
| 2015-08-12 | Midnight in the Desert - Open Lines: September Doom | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-08-12 - Art Bell MITD - Open Lines September Doom.mp3` |
| 2015-08-21 | Midnight in the Desert - Open Lines: Pact with the Devil | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-08-21 - Art Bell MITD - Open Lines Pact With the Devil.mp3` |
| 2015-08-28 | Midnight in the Desert - Open Lines: Truth or Trash | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-08-28 - Art Bell MITD - Open Lines Truth Or Trash.mp3` |
| 2015-09-02 | Midnight in the Desert - Open Lines: Married to an Alien | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-09-02 - Art Bell MITD - Open Lines Married To An Alien Line.mp3` |
| 2015-09-11 | Midnight in the Desert - Open Lines: Atheist Debate and Planet X | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-09-11 - Art Bell MITD - Open Lines Atheist Debate & Planet X.mp3` |
| 2015-09-25 | Midnight in the Desert - Open Lines: Anything Goes and I'm Losing My Mind | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-09-25 - Art Bell MITD - Open Lines Anything Goes & I'm Losing My Mind Line.mp3` |
| 2015-10-02 | Midnight in the Desert - Open Lines: I Married an Alien | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-10-02 - Art Bell MITD - I Married An Alien.mp3` |
| 2015-10-09 | Midnight in the Desert - Open Lines: Scott Free Line | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-10-09 - Art Bell MITD - Open Lines Scott Free Line.mp3` |
| 2015-10-16 | Midnight in the Desert - Open Lines: Super Power Line | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-10-16 - Art Bell MITD - Open Lines Super Power Line.mp3` |
| 2015-10-23 | Midnight in the Desert - Open Lines: 30-Year Prediction Line | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-10-23 - Art Bell MITD - Open Lines Future 30 Year Prediction Line.mp3` |
| 2015-11-06 | Midnight in the Desert - Open Lines: Past Lives Line | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-11-06 - Art Bell MITD - Open Lines Past Lives Line.mp3` |
| 2015-11-13 | Midnight in the Desert - Open Lines: The Paris Attacks | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-11-13 - Art Bell MITD - Open Lines Paris Attacks.mp3` |
| 2015-11-20 | Midnight in the Desert - Open Lines: Preppers' Line | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-11-20 - Art Bell MITD - Open Prepper's Line.mp3` |
| 2015-11-27 | Midnight in the Desert - Open Lines: Anything Goes | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-11-27 - Art Bell MITD - Open Lines Anything Goes.mp3` |
| 2015-12-02 | Midnight in the Desert - Open Lines: The San Bernardino Shooting | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-12-02 - Art Bell MITD - Open Lines San Bernardino Shooting.mp3` |
| 2015-12-04 | Midnight in the Desert - Open Lines: Inhuman Encounter Line | Open Lines | `archive:Art-Bell_Midnight_In_the_Desert:2015-12-04 - Art Bell MITD - Open Lines Inhuman Encounter Line.mp3` |
