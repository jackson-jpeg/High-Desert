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
