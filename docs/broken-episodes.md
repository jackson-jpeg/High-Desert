# Episodes pulled from the catalog

Shows removed from `public/seed/library.json` because the archive.org copy is
not playable. Kept here so they can be re-sourced rather than quietly forgotten
— a removal with no record is just data loss on a delay.

Re-add by restoring the JSON object to `public/seed/library.json` and running
`node scripts/gen-community-keys.mjs`. The removal below is the only edit; the
original record is reproduced in full so nothing has to be reconstructed.

Detected by `scripts/audit-durations.mjs`, which reads the first 64KB of actual
audio from each file and walks the MPEG frame headers. Nothing at the HTTP layer
catches these: archive.org serves them with a clean `206`, the correct
`Content-Type: audio/mpeg`, and a plausible `Content-Length`.

## Last full sweep — 2026-07-29, all 1,313 episodes

```
checked 1313 · ok 1308 · flagged 5
  no audio in the file:  1   (pulled — below)
  duration mismatch:     4   (catalog metadata errors, files are fine)
```

**Exactly one episode in the catalog has no audio in it.** The other four
flagged rows are all files *longer* than the catalog claims, which is a wrong
number in the metadata rather than a defect in the audio, and none of them can
trip the runtime guard — that only fires on a file much *shorter* than
catalogued. Left alone; the player reads duration from the element anyway.

| Episode | Catalog says | File actually holds |
|---|---|---|
| 1999-01-25 — Chemtrails and HAARP | 18s | ~2h35m |
| 1998-01-13 — Trends Research and Phoenix Lights | 43m | ~2h16m |
| 2000-03-31 — Remote Viewing and Antarctica | 34m | ~2h36m |
| 2001-11-26 — Egyptian Cave in Illinois | 2h18m | ~6h58m (wrong: a full frame walk on 2026-10-11 counts 8,283 s, 2h18m, as catalogued. The 64KB sample extrapolated. This file was later repaired for another reason, below) |

---

## 2002-03-19 — Coast to Coast AM: Climate Change (Prof. Christina Hulbe)

**Pulled 2026-07-29.** Contains no audio whatsoever.

| | |
|---|---|
| File | `2002-03-19 - Coast to Coast AM with Art Bell - Climate Change - Prof. Christina Hulbe.mp3` |
| Item | `ultimate-ultimate-art-bell-collection` |
| Size | 77,380 bytes |
| MPEG frames | **0** |
| Playable audio | **0 seconds** |
| archive.org `length` | `"0"` |

The whole file is a single ID3v2 tag wrapping a JPEG cover image. The typical
tag on this collection is ~77,700 bytes, so this file is *exactly one cover-art
tag with the audio never appended* — the rip failed after writing metadata and
nobody noticed, because the result is a well-formed MP3 container that any
byte-range check passes.

It is worse than empty, in fact. The tag's own header declares that it ends at
byte **77,774**, and the file is **77,380** bytes long — it stops 394 bytes
before its own metadata finishes. Asking archive.org for the bytes after the tag
returns `416 Range Not Satisfiable`:

```
GET  bytes=0-65535          -> 206   (ID3 header says the tag ends at 77,774)
GET  bytes=77774-143309     -> 416   (there is nothing there)
```

To a listener this reads as the show refusing to start, which is the complaint
that began this whole investigation.

**To re-source:** find another rip of the 2002-03-19 broadcast. The episode
itself is not rare; only this copy of it is broken.

```json
{
  "fileHash": "archive:ultimate-ultimate-art-bell-collection:2002-03-19 - Coast to Coast AM with Art Bell - Climate Change - Prof. Christina Hulbe.mp3",
  "fileName": "2002-03-19 - Coast to Coast AM with Art Bell - Climate Change - Prof. Christina Hulbe.mp3",
  "filePath": "https://archive.org/download/ultimate-ultimate-art-bell-collection/2002-03-19%20-%20Coast%20to%20Coast%20AM%20with%20Art%20Bell%20-%20Climate%20Change%20-%20Prof.%20Christina%20Hulbe.mp3",
  "sourceUrl": "https://archive.org/download/ultimate-ultimate-art-bell-collection/2002-03-19%20-%20Coast%20to%20Coast%20AM%20with%20Art%20Bell%20-%20Climate%20Change%20-%20Prof.%20Christina%20Hulbe.mp3",
  "archiveIdentifier": "ultimate-ultimate-art-bell-collection",
  "fileSize": 77380,
  "title": "Coast to Coast AM - Climate Change",
  "artist": "Art Bell",
  "airDate": "2002-03-19",
  "guestName": "Prof. Christina Hulbe",
  "showType": "coast",
  "format": "mp3",
  "source": "archive"
}
```

---

## Checked and kept

Two other episodes were short enough to look suspicious and are **not** broken.
Recording them here so the question does not get re-opened every time someone
sorts the catalog by file size.

| Episode | Size | Measured audio | Verdict |
|---|---|---|---|
| 1998-09-17 — Climate Change (Linda Moulton Howe) | 7,578,345 B | **5m25s**, 24,120 frames | Real segment, kept |
| 2001-01-09 — Keith Rowland interview | 3,909,514 B | **5m29s**, 22,738 frames | Real segment, kept |

Both were measured by decoding the complete file, not sampling it. They have no
`duration` in the catalog for the same reason the Hulbe file does not:
archive.org's VBR derive reports `length: "0"` for five episodes in this
collection, two of which are full three-hour broadcasts. **A missing duration
says nothing about whether a file has audio in it.**

---

## Visitors who already have a pulled episode

`reconcileLibrary()` is `bulkAdd`-only and never deletes, so anyone who has
already seeded their IndexedDB keeps these rows. That is deliberate — see the
data-safety notes in `CLAUDE.md` — and it is why the runtime guard exists:
`src/audio/duration-sanity.ts` catches an empty file at playback time and raises
the error dialog instead of playing silence. Removing an episode from the seed
stops it reaching new visitors; the guard covers everyone else.

Since 2026-09-25 those visitors are also told. Every pulled `fileHash` is listed
in `src/lib/library/removed-episodes.ts` (a test holds that list equal to the
JSON records in this file), and a listed row shows **Unavailable** in the list
and detail panel, refuses to play with an explanation instead of fetching the
empty file, and offers **Remove from my library** — the listener's decision,
through the library's delete confirmation and `deleteEpisode()`. Nothing deletes
it automatically. **Adding a section here means adding its hash there.**

---

## Repaired, not pulled: re-encoded copies on the mirror

A file that changes stream configuration midstream (channel layout or sample
rate) is **repaired, not pulled** (Jackson, 2026-10-11): it is re-encoded once
to one layout and one rate (`scripts/repair-episode.mjs`), and the mirror
serves the copy ahead of everything else
(`/var/lib/highdesert-mirror/repaired/<fileHash>`, tried before `pins/` in
`services/mirror/lib/nginx.mjs`). **The original on archive.org is untouched**,
and its size, sha256 and segments are recorded beside the copy's in
`src/data/repaired-episodes.json`. That record is what the rest reads:

- the player sends a repaired show to `/mirror/{fileHash}` only, never to
  archive.org (`isRepaired()` in `src/audio/sources.ts`; the restored-show
  prime and the radio's scan preview use the same choice);
- the mirror's manifest lists it, so it stays playable in an outage, and the
  warm job never pins the broken original (`services/mirror/lib/pins.mjs`);
- the station's pre-air check walks the copy, not the original
  (`scripts/verify-live-day.mjs`).

The copy is accepted only if a full frame walk finds one configuration, the
layout asked for, and a runtime within 2 s of the original's frame count.
Mono, at the rate most of the original is in (44.1 kHz at 64 kbps, or
22.05 kHz at 32 kbps for the 22.05 kHz rips), CBR: right for AM talk radio,
and no larger than the original. **A single stray frame is
enough to stop Chromium.** Measured 2026-10-11 in headless Chromium,
seeking 6 s before the stray frame and playing through it: both 1994-10-28
(at 262.01 s) and 1996-09-09 (at 8,390.37 s) stopped with
`code=3 PIPELINE_ERROR_DECODE: … malformed stream: mpa: invalid audio buffer
signal spec for packet` within 0.25 s of the frame. The control, a clean
pinned show played across the same offset, kept playing. To repair another (run niced, under heavy):

```
heavy -- nice -n 19 ionice -c3 node scripts/repair-episode.mjs '<fileHash>'
```

| Episode | What the original does | Copy | Repaired |
|---|---|---|---|
| 2001-11-26 Egyptian Cave in Illinois (Glenn Kimball) | stereo 0:00 to 43:59, then mono to the end, 44.1 kHz | mono 44.1 kHz 64 kbps, 66,266,927 B, 8,283.32 s, one configuration | 2026-10-11 |
| 1994-10-28 Ghost To Ghost 1994 | 22.05 kHz mono, one stray 16 kHz stereo frame at 4:22 (and 13 runs of junk) | mono 22.05 kHz 32 kbps, 49,449,550 B, 12,362.29 s, one configuration | 2026-10-11 |
| 1996-09-09 Open Lines: TWA 800, Art's Parts, Crop Circles | 22.05 kHz mono, one stray stereo frame at 2:19:50 | mono 22.05 kHz 32 kbps, 40,260,563 B, 10,065.03 s, one configuration | 2026-10-11 |
| 2001-09-11 The September 11, 2001 Show | 22.05 kHz mono, one stray stereo frame at 2:53:09 | mono 22.05 kHz 32 kbps, 42,032,254 B, 10,507.96 s, one configuration | 2026-10-11 |
| 2001-12-04 Joshua P. Warren: Ghost Hunting, Brown Mountain Lights | 22.05 kHz mono, one stray stereo frame at 39:35 | mono 22.05 kHz 32 kbps, 38,235,812 B, 9,558.83 s, one configuration | 2026-10-11 |

**Cross-check against the failure rows** (`playback_failures`, all time, read
2026-10-11). A decode error (`code=3 PIPELINE_ERROR_DECODE`) has been
recorded on exactly two episodes, and both are hits above: 2001-11-26 (35
rows, android-chrome) and 2001-09-11 (1 row, android-chrome, on 2026-09-11,
the show's anniversary). Every other "Format error" row (87 episodes) is
`code=4 MEDIA_ELEMENT_ERROR`, the element failing to load its source, which
is archive.org's storage-node 500 (docs/firefox-notsupportederror.md), not
the file. A hit with no decode row was played rarely, or not past its stray
frame.

### 2001-11-26 — Coast to Coast AM: Egyptian Cave in Illinois (Glenn Kimball)

**Pulled on 2026-10-11 and restored the same day as a repair** (the pull was
never deployed, so no visitor saw it marked unavailable). `SEED_VERSION`
`2026-10-11-b`, catalog 1,413. The file changes from stereo to mono 43
minutes 59 seconds in, and Chromium refuses that midstream.

| | |
|---|---|
| File | `2001-11-26 - Coast to Coast AM with Art Bell - Glenn Kimball - Egypt Illinois Cave.mp3` |
| Item | `ultimate-ultimate-art-bell-collection` (the original collection, not the 2026-09-28 community import) |
| Original | 100,935,721 bytes, sha256 `6128c7f9…cd63`, identical from archive.org and through the mirror's fill |
| MPEG frames | 317,096 (8,283.32 s), all 44,100 Hz |
| Configuration | **stereo for frames 1 to 101,037 (0:00 to 43:59), mono from 43:59 to the end** (216,059 frames) |
| Copy | 66,266,927 bytes, sha256 `2d75fd7d…0442`, mono 44.1 kHz 64 kbps, 8,283.32 s, decodes with no errors (`ffmpeg -v error … -f null -`) |

Every Chromium-engine browser that reaches 43:59, or starts past it (a
resumed position), failed on the original with:

```
code=3 PipelineStatus::PIPELINE_ERROR_DECODE: Unsupported midstream configuration change!
Sample Rate: 44100 vs 44100, Channels: 1 vs 2
```

It was 37 of the 119 failure rows in the week to 2026-10-05 (the digest's
"most failing show"): 35 `decode-error` on `android-chrome`, all on
2026-10-01 between 17:54 and 19:44 UTC, in bursts about a second apart, each
failing within ~100 ms of starting. That cadence is a listener pressing Try
Again, not the station: the station aired this show on 09-22, 09-24 and
09-27, never on 10-01 (`live_days`). Since 2026-10-11 the release line counts
that as one lost start per tab per show (`docs/reliability-baseline.md`).

**No lossless repair exists.** An MPEG Layer III mono frame cannot be
rewritten as a stereo one (or the reverse) without decoding and re-encoding,
and splitting the file at 43:59 would make one broadcast two catalog rows. So
the copy is a lossy re-encode, made once. ffmpeg reported a few "Header
missing" packets in the original (junk between frames, which the walker
counts as resyncs); the copy's runtime matches the original's frame count to
the hundredth of a second, so nothing audible was dropped.
