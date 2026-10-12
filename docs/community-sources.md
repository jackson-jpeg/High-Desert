# Community sources: a listener's torrents, checked against the catalog

On 2026-09-27 a listener sent three torrents as extra sources for the archive.
This is what they contain, what the catalog already had, and what was added
from archive.org as a result. Written 2026-09-28.

## Ground rules

None of the three torrents' content was downloaded, and no swarm was joined,
from this server or anywhere else. Public swarms are monitored, and a copyright
notice to Hostinger would put every project on this server at risk.

- Only each torrent's metadata file (the `.torrent`, a few hundred KB at most)
  was fetched, by infohash, over plain HTTPS from a public torrent cache.
- There were no peer connections, no DHT and no BitTorrent client.
- Each file was checked: the SHA-1 of its bencoded `info` dictionary must equal
  the infohash.
- The magnets are not hosted or linked anywhere in the app.
  `scripts/__tests__/community-sources.test.ts` fails if any of the three
  infohashes appears under `public/`, `src/`, `data/` or `services/`.
- Every show added here streams from **archive.org**, like the rest of the
  catalog. The torrents were used only as a list of names.

## The three torrents

| Torrent | Size | File list |
|---|---|---|
| "C2C Addendum 2" (`93fc757f…`) | 4.3 GB, 55 files | itorrents.org, SHA-1 verified |
| "Coast to Coast AM" (`52140830…`) | 48 GB, 1,785 files | itorrents.org, SHA-1 verified |
| "Coast to Coast" (`d178cf21…`) | 97 GB | **Not found in any cache** |

The third torrent could not be read, so nothing below covers it:

- **itorrents.org / .net:** 404.
- **btcache.me:** 502.
- **torrage.info:** answers with a JavaScript token page, and failed even for a
  hash itorrents has.
- **thetorrent.org, torrent.cd, torcache.net:** no connection.
- **Search pages** (bitsearch, torrentz2, torrentdownload.info): no result.
  bt4g and btdig refused.

## Counts

Only Art Bell's own shows were kept:

- **Included:** Coast to Coast AM with Art Bell, Dreamland, Art Bell specials,
  Dark Matter (2013), and Midnight in the Desert while he hosted it.
- **Excluded:** 603 files whose host was someone else (George Noory, John B.
  Wells and others, or a dated weeknight after 2002).
- Split-hour files ("… 1/2/3") count as one show.

| | Shows |
|---|---|
| Art Bell shows in the two readable torrents | **353** |
| Already in the catalog | **238** |
| Missing from the catalog | **115** |
| Missing, found on archive.org | **107** |
| Found on archive.org and **added** | **101** |
| Found on archive.org, held back (below) | 6 |
| Missing, **not found** on archive.org | **8** |

Of the 238 already in the catalog:

- **84 are certain:** same air date (±1 day) and a shared name.
- **154 are likely:** mostly undated files matched on guest and topic words
  (weighted by how rare the words are). A few are dated files one field off
  from the catalog's date.

The show-by-show classification, with each match's reason, is kept with the
working files, not in the repository.

## What was added (101), and from where

All went through `scripts/import-community-sources.mjs`. It builds each row as
collection import does (`src/services/archive/collection-import.ts`):

- identity `archive:{identifier}:{fileName}`;
- the archive.org stream URL;
- size and duration from archive.org's own item metadata.

Guest and topic are curated by hand in `data/community-sources.json`, because
these file names run the two together. That file also keeps each show's
provenance: the torrent and file that named it, and the archive.org item and
file it streams from. The import is add-only: all 1,312 existing rows are
unchanged. The catalog is now **1,413**.

| archive.org item | Shows |
|---|---|
| `Art-Bell_Midnight_In_the_Desert` | 98 Midnight in the Desert, 2015-07-20 to 2015-12-08 |
| `art-bell-2001-to-2010` | Dreamland 1994-07-04 (John Rhodes, "The Reptilian Connection") |
| `1993-06-20-coast-to-coast-am-with-art-bell-al-bielek-philadelphia-experiment_202510` ("Art Bell Collection", uploaded 2025-10) | Coast to Coast AM 1998-03-05 (Bruce Rux, "Hollywood and UFOs") |
| `art-bell-1990-2000` | Coast to Coast AM 1997-02-19 (Jim Forbes, "Strange Universe"), filed `special`: it is a "Somewhere in Time" rebroadcast |

- **Midnight in the Desert is new to the catalog.** It had nothing after 2013.
  These are `special`, as the archive filename parser already files the show,
  titled "Midnight in the Desert - {topic}".
- New rows carry no AI summary or tags yet.
  `scripts/categorize-library.py` writes those offline, as for any imported
  episode.
- The mirror gets each new episode's torrent the usual way:
  `build-torrent-index.mjs --hash` streams the file from archive.org once and
  keeps only the `.torrent`.

## Held back (6)

These are on archive.org, but Art Bell was not, or is not known to have been,
the host, or the air date cannot be established:

- **Midnight in the Desert 2016-03-11 ("Open Lines, Art's Final Show").** Art
  Bell stepped down as host on 2015-12-11 and Heather Wade hosted after that.
  The import refuses any Midnight in the Desert dated later
  (`MITD_LAST_DAY`).
- **Ghost to Ghost 2000.** Art Bell was off the air from April 2000 to February
  2001, and the file is one hour long.
- **Ghost to Ghost 1999 and 2002.** archive.org names only the year, and that
  item's year-only Ghost to Ghost files are not dated reliably: its "1994",
  "1998" and "2000" files turn out to be the catalog's 1994-10-28, 1998-11-27
  and 2000-02-23 shows. A guessed 31 October would put a show on the live
  station on the wrong day.
- **Ghost to Ghost 2008 and 2009.** By then Art Bell hosted only occasionally,
  and nothing confirms he hosted these.

## Not found on archive.org (8)

All but one are undated, and each of these guests has several shows in the
catalog already. So the file cannot be tied to one airing to search for.

- Richard C. Hoagland, "Artificial Structures on Mars"
- Dr. Evelyn Paglini, "Using Witchcraft" (the file says 2003-03-13, a Thursday;
  Art Bell hosted only weekends then, so it is probably misdated)
- Gregg Braden, "Hidden Mysteries & Technology"
- Jim Marrs, "UFOs & Government Secrecy"
- Maurice Cotterell, "Sun Cycles & Ancient Civilizations"
- Paul Eno, "Spirits, Poltergeists, & Parallel Realms"
- Stanton Friedman, "Roswell & Varginha UFO Cases"
- Whitley Strieber, "Project Serpo"

None of them was fetched from anywhere else.

## Categories, assigned by hand (2026-10-12)

The 101 shows came in with no `aiCategory`, so they sat outside every
category filter. `scripts/categorize-library.py` would have done it, but no
working Anthropic key was on the box (both tried returned 401), so Jackson
asked for them to be assigned in the session, by the categorizer's own rules
and from its own list (`CATEGORIES` in that script):

- one category per show, the most specific that fits;
- "Open Lines" for call-in nights. A themed call-in night ("Open Lines:
  Pact with the Devil") stays Open Lines, as 90 of the catalog's 104
  Open Lines titles already do;
- "Other" only when nothing else fits;
- Halloween and Ghost to Ghost shows are Paranormal & Ghosts.

Where a guest or a subject already appears in the catalog, the catalog's
majority category for them was followed, and the reason says so. The list
is `data/community-categories.json`; the seed carries it, and
`refreshCatalogCategories()` (`src/db/catalog-flags.ts`) sets it on
libraries seeded earlier, once, only where a row has no category.
`src/db/__tests__/community-categories.test.ts` holds the seed, the list and
this table equal. Only the category was assigned: these rows still have no
summary or tags (`aiStatus: "pending"`).

Two are guesses worth checking by ear: 2015-10-27 (Tish Owen, no topic) and
1997-02-19 (Strange Universe, a TV show that mixed UFOs and the paranormal).

| Air date | Title | Category | Why |
|---|---|---|---|
| 1994-07-04 | Dreamland - The Reptilian Connection | UFOs & Aliens | reptilians as an alien race; the catalog's two other reptilian shows are UFOs & Aliens |
| 1997-02-19 | Coast to Coast AM - Strange Universe | Paranormal & Ghosts | Jim Forbes hosted Strange Universe, a paranormal TV magazine |
| 1998-03-05 | Coast to Coast AM - Hollywood and UFOs | UFOs & Aliens | UFOs in film |
| 2015-07-20 | Midnight in the Desert - Graham Hancock | Ancient Mysteries | Graham Hancock; 7 of his 9 catalog shows are Ancient Mysteries |
| 2015-07-21 | Midnight in the Desert - Biological Warfare | Conspiracy & Government | bioweapons, with a former CIA officer |
| 2015-07-22 | Midnight in the Desert - Linda Moulton Howe | UFOs & Aliens | Linda Moulton Howe; 21 of her catalog shows are UFOs & Aliens |
| 2015-07-23 | Midnight in the Desert - Nassim Haramein | Science & Physics | Nassim Haramein's unified field physics |
| 2015-07-24 | Midnight in the Desert - Open Lines | Open Lines | call-in night |
| 2015-07-27 | Midnight in the Desert - Grant Cameron | UFOs & Aliens | Grant Cameron, UFO researcher (presidents and UFOs) |
| 2015-07-28 | Midnight in the Desert - Richard Dolan | UFOs & Aliens | Richard Dolan, UFO historian |
| 2015-07-29 | Midnight in the Desert - UFOs and the Paranormal | UFOs & Aliens | topic: UFOs and the paranormal; UFOs first |
| 2015-07-30 | Midnight in the Desert - Life Beyond Earth | Space & Astronomy | life beyond Earth, with an astronomy writer |
| 2015-07-31 | Midnight in the Desert - Open Lines: Paranormal Stories | Open Lines | call-in night (themed); themed Open Lines stay Open Lines, as in the catalog |
| 2015-08-01 | Midnight in the Desert - The Church of Satan | Religion & Spirituality | the Church of Satan; Satanism shows are Religion & Spirituality |
| 2015-08-03 | Midnight in the Desert - Open Lines: Shadow People Stories | Open Lines | call-in night (themed) |
| 2015-08-04 | Midnight in the Desert - Jay Weidner and Stanton Friedman | UFOs & Aliens | Stanton Friedman; all 4 of his catalog shows are UFOs & Aliens |
| 2015-08-05 | Midnight in the Desert - Flat Earth Debate | Science & Physics | the shape of the Earth, debated |
| 2015-08-06 | Midnight in the Desert - Bigfoot Discovery Museum | Cryptozoology | Bigfoot |
| 2015-08-07 | Midnight in the Desert - Alien Abductions | UFOs & Aliens | alien abduction, Travis Walton |
| 2015-08-10 | Midnight in the Desert - Remote Viewing | Psychology & Consciousness | remote viewing, Joe McMoneagle |
| 2015-08-11 | Midnight in the Desert - SETI | Space & Astronomy | SETI's radio search, with its senior astronomer |
| 2015-08-12 | Midnight in the Desert - Open Lines: September Doom | Open Lines | call-in night (themed) |
| 2015-08-14 | Midnight in the Desert - Time Travel and Teleportation | Conspiracy & Government | Andrew Basiago's claimed secret government time-travel program |
| 2015-08-17 | Midnight in the Desert - ET Contact | UFOs & Aliens | ET contact |
| 2015-08-18 | Midnight in the Desert - Exorcism | Religion & Spirituality | exorcism; 6 of 9 catalog exorcism shows are Religion & Spirituality |
| 2015-08-19 | Midnight in the Desert - TWA Flight 800 | Conspiracy & Government | TWA Flight 800 cover-up |
| 2015-08-20 | Midnight in the Desert - EVPs | Paranormal & Ghosts | EVPs |
| 2015-08-21 | Midnight in the Desert - Open Lines: Pact with the Devil | Open Lines | call-in night (themed) |
| 2015-08-24 | Midnight in the Desert - Global Consciousness | Psychology & Consciousness | Dean Radin; all 5 of his catalog shows are Psychology & Consciousness |
| 2015-08-25 | Midnight in the Desert - Rendlesham Forest | UFOs & Aliens | the Rendlesham Forest UFO |
| 2015-08-26 | Midnight in the Desert - Artificial Intelligence | Technology & Invention | artificial intelligence |
| 2015-08-27 | Midnight in the Desert - Anti-Aging | Health & Medicine | anti-aging medicine |
| 2015-08-28 | Midnight in the Desert - Open Lines: Truth or Trash | Open Lines | call-in night (themed) |
| 2015-08-31 | Midnight in the Desert - Asteroids and the Cosmos | Space & Astronomy | asteroids |
| 2015-09-01 | Midnight in the Desert - EVPs | Paranormal & Ghosts | EVPs |
| 2015-09-02 | Midnight in the Desert - Open Lines: Married to an Alien | Open Lines | call-in night (themed) |
| 2015-09-02 | Midnight in the Desert - National UFO Reporting Center | UFOs & Aliens | the National UFO Reporting Center |
| 2015-09-03 | Midnight in the Desert - Weird Creatures | Cryptozoology | Linda Godfrey's unknown creatures |
| 2015-09-04 | Midnight in the Desert - Time Traveler | Technology & Invention | Mad Man Markum's time machine device |
| 2015-09-07 | Midnight in the Desert - Missing 411 | Crime & Mystery | Missing 411: unexplained disappearances |
| 2015-09-08 | Midnight in the Desert - Witchcraft | Religion & Spirituality | witchcraft; 4 of 8 catalog witchcraft shows are Religion & Spirituality |
| 2015-09-09 | Midnight in the Desert - Bigfoot in the Back Yard | Cryptozoology | Bigfoot |
| 2015-09-10 | Midnight in the Desert - Space Warp Technology | Technology & Invention | space warp technology |
| 2015-09-11 | Midnight in the Desert - Open Lines: Atheist Debate and Planet X | Open Lines | call-in night (themed) |
| 2015-09-14 | Midnight in the Desert - Crop Circles | UFOs & Aliens | crop circles; 9 of 15 catalog crop circle shows are UFOs & Aliens |
| 2015-09-15 | Midnight in the Desert - Loyd Auerbach | Paranormal & Ghosts | Loyd Auerbach, parapsychologist and ghost investigator |
| 2015-09-16 | Midnight in the Desert - Shadow People | Paranormal & Ghosts | shadow people |
| 2015-09-17 | Midnight in the Desert - The Rendlesham Forest UFO | UFOs & Aliens | the Rendlesham Forest UFO |
| 2015-09-21 | Midnight in the Desert - Near-Death Experiences | Paranormal & Ghosts | near-death experiences; 13 of 24 catalog NDE shows are Paranormal & Ghosts |
| 2015-09-22 | Midnight in the Desert - Climate Change | Earth Changes & Environment | climate change, with a climate scientist |
| 2015-09-24 | Midnight in the Desert - UFOs and Alien Abductions | UFOs & Aliens | UFOs and alien abduction |
| 2015-09-25 | Midnight in the Desert - Open Lines: Anything Goes and I'm Losing My Mind | Open Lines | call-in night (themed) |
| 2015-09-28 | Midnight in the Desert - Unsolved Mysteries | Crime & Mystery | unsolved mysteries |
| 2015-09-29 | Midnight in the Desert - Nuclear War | Earth Changes & Environment | nuclear war and nuclear winter, with Steven Starr |
| 2015-09-30 | Midnight in the Desert - Out-of-Body Experiences | Psychology & Consciousness | out-of-body experiences; 10 of 12 catalog OBE shows are Psychology & Consciousness |
| 2015-10-01 | Midnight in the Desert - Father Michael Maginot | Religion & Spirituality | Father Michael Maginot, the priest who performed the Gary, Indiana exorcisms |
| 2015-10-02 | Midnight in the Desert - Open Lines: I Married an Alien | Open Lines | call-in night (themed) |
| 2015-10-05 | Midnight in the Desert - Gravity | Other | Tess Gerritsen, thriller novelist (Gravity is her novel) |
| 2015-10-06 | Midnight in the Desert - Time Travel | Science & Physics | Ronald Mallett, physicist, on time travel |
| 2015-10-07 | Midnight in the Desert - Sounds of Sasquatch | Cryptozoology | Sasquatch recordings |
| 2015-10-08 | Midnight in the Desert - Hacking | Technology & Invention | hacking, Kevin Mitnick |
| 2015-10-09 | Midnight in the Desert - Open Lines: Scott Free Line | Open Lines | call-in night (themed) |
| 2015-10-10 | Midnight in the Desert - Bigfoot Sounds | Cryptozoology | Bigfoot recordings |
| 2015-10-12 | Midnight in the Desert - Psychedelic Research | Psychology & Consciousness | psychedelic research |
| 2015-10-13 | Midnight in the Desert - Dr. Barry Taff | Paranormal & Ghosts | Barry Taff; all 3 of his catalog shows are Paranormal & Ghosts |
| 2015-10-14 | Midnight in the Desert - Disclosure | UFOs & Aliens | Steven Greer, UFO disclosure |
| 2015-10-15 | Midnight in the Desert - Reality Shifting | Psychology & Consciousness | reality shifting |
| 2015-10-16 | Midnight in the Desert - Open Lines: Super Power Line | Open Lines | call-in night (themed) |
| 2015-10-20 | Midnight in the Desert - Hubrids, Part II | UFOs & Aliens | David Jacobs on alien-human hybrids |
| 2015-10-21 | Midnight in the Desert - Space Elevators and EMPs | Technology & Invention | space elevators and EMPs |
| 2015-10-22 | Midnight in the Desert - Nanotechnology | Technology & Invention | nanotechnology; 12 of 13 catalog nanotech shows are Technology & Invention |
| 2015-10-23 | Midnight in the Desert - Open Lines: 30-Year Prediction Line | Open Lines | call-in night (themed) |
| 2015-10-26 | Midnight in the Desert - The Ghost Phenomenon | Paranormal & Ghosts | ghosts |
| 2015-10-27 | Midnight in the Desert - Tish Owen | Other | Tish Owen: no topic, and the guest is not otherwise identified; check by ear |
| 2015-10-28 | Midnight in the Desert - The Amityville Horror Hoax | Paranormal & Ghosts | the Amityville haunting |
| 2015-10-29 | Midnight in the Desert - Neil deGrasse Tyson | Space & Astronomy | Neil deGrasse Tyson, astrophysicist |
| 2015-10-30 | Midnight in the Desert - Halloween Special: Dead Air | Paranormal & Ghosts | Halloween special; the catalog's 3 Halloween shows are Paranormal & Ghosts |
| 2015-11-02 | Midnight in the Desert - Survival | Other | wilderness survival skills |
| 2015-11-03 | Midnight in the Desert - Megastructures and More | Space & Astronomy | megastructures: the 2015 Tabby's star news |
| 2015-11-04 | Midnight in the Desert - A True Haunting | Paranormal & Ghosts | a haunting |
| 2015-11-05 | Midnight in the Desert - Past Life Regressions | Psychology & Consciousness | past-life regression; 5 of 10 catalog past-life shows are Psychology & Consciousness |
| 2015-11-06 | Midnight in the Desert - Open Lines: Past Lives Line | Open Lines | call-in night (themed) |
| 2015-11-09 | Midnight in the Desert - Ralph Sarchie | Paranormal & Ghosts | Ralph Sarchie, demonologist; his other catalog show is Paranormal & Ghosts |
| 2015-11-10 | Midnight in the Desert - Digital Simulated Reality | Science & Physics | the simulation hypothesis |
| 2015-11-11 | Midnight in the Desert - Storm Chasing | Earth Changes & Environment | storm chasing |
| 2015-11-12 | Midnight in the Desert - Lucid Dreaming | Psychology & Consciousness | lucid dreaming |
| 2015-11-13 | Midnight in the Desert - Open Lines: The Paris Attacks | Open Lines | call-in night (themed) |
| 2015-11-16 | Midnight in the Desert - Underwater Cave Exploration | Other | underwater cave diving |
| 2015-11-17 | Midnight in the Desert - 100 Years of UFO Cover-ups | UFOs & Aliens | UFO cover-ups, Kevin Randle |
| 2015-11-18 | Midnight in the Desert - Feral Humans | Cryptozoology | feral humans and wild men |
| 2015-11-20 | Midnight in the Desert - Open Lines: Preppers' Line | Open Lines | call-in night (themed) |
| 2015-11-23 | Midnight in the Desert - Michio Kaku | Science & Physics | Michio Kaku; 18 of his 22 catalog shows are Science & Physics |
| 2015-11-25 | Midnight in the Desert - The Seres Agenda | UFOs & Aliens | R. Scott Lemriel's claimed extraterrestrial contact |
| 2015-11-27 | Midnight in the Desert - Open Lines: Anything Goes | Open Lines | call-in night (themed) |
| 2015-11-30 | Midnight in the Desert - Flying Humanoids | Cryptozoology | flying humanoids |
| 2015-12-01 | Midnight in the Desert - Master of the Macabre | Other | Todd Robbins, sideshow performer |
| 2015-12-02 | Midnight in the Desert - Open Lines: The San Bernardino Shooting | Open Lines | call-in night (themed) |
| 2015-12-03 | Midnight in the Desert - Legal Marijuana | Health & Medicine | legal marijuana |
| 2015-12-04 | Midnight in the Desert - Open Lines: Inhuman Encounter Line | Open Lines | call-in night (themed) |
| 2015-12-07 | Midnight in the Desert - Modern Mind Control | Psychology & Consciousness | Neil Sanders on manipulation and persuasion techniques |
| 2015-12-08 | Midnight in the Desert - Alien Experimentation on Humans | UFOs & Aliens | David Jacobs on alien abduction |
