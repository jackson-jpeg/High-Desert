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
| 2001-11-26 — Egyptian Cave in Illinois | 2h18m | ~6h58m (wrong: a full frame walk on 2026-10-11 counts 8,283 s, 2h18m, as catalogued. The 64KB sample extrapolated. This file was later pulled for another reason, below) |

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

## 2001-11-26 — Coast to Coast AM: Egyptian Cave in Illinois (Glenn Kimball)

**Pulled 2026-10-11.** The file changes from stereo to mono 43 minutes 59
seconds in, and Chromium refuses that midstream.

| | |
|---|---|
| File | `2001-11-26 - Coast to Coast AM with Art Bell - Glenn Kimball - Egypt Illinois Cave.mp3` |
| Item | `ultimate-ultimate-art-bell-collection` (the original collection, not the 2026-09-28 community import) |
| Size | 100,935,721 bytes, identical from archive.org and through the mirror |
| MPEG frames | 317,096 (8,283 s), all 44,100 Hz |
| Configuration | **stereo for frames 1 to 101,037 (0:00 to 43:59), mono from 43:59 to the end** (216,059 frames) |

Every Chromium-engine browser that reaches 43:59, or starts past it (a
resumed position), fails with:

```
code=3 PipelineStatus::PIPELINE_ERROR_DECODE: Unsupported midstream configuration change!
Sample Rate: 44100 vs 44100, Channels: 1 vs 2
```

It was 37 of the 119 failure rows in the week to 2026-10-05 (the digest's
"most failing show"): 35 `decode-error` on `android-chrome`, all on
2026-10-01 between 17:54 and 19:44 UTC, in bursts about a second apart, each
failing within ~100 ms of starting. That cadence is a listener pressing Try
Again, not the station: the station aired this show on 09-22, 09-24 and 09-27,
never on 10-01 (`live_days`). The rows hold no session, so whether it was one
phone or a few cannot be told.

**No lossless repair exists.** An MPEG Layer III mono frame cannot be
rewritten as a stereo one (or the reverse) without decoding and re-encoding,
and splitting the file at 43:59 would make one broadcast two catalog rows.
Walked with `scripts/measure-duration.mjs`, which now reports configuration
`segments`.

**To re-source:** find another rip of the 2001-11-26 broadcast with one
channel layout throughout, or re-encode this one to a single layout (lossy)
and host it as a new item.

```json
{
  "fileHash": "archive:ultimate-ultimate-art-bell-collection:2001-11-26 - Coast to Coast AM with Art Bell - Glenn Kimball - Egypt Illinois Cave.mp3",
  "fileName": "2001-11-26 - Coast to Coast AM with Art Bell - Glenn Kimball - Egypt Illinois Cave.mp3",
  "filePath": "https://archive.org/download/ultimate-ultimate-art-bell-collection/2001-11-26%20-%20Coast%20to%20Coast%20AM%20with%20Art%20Bell%20-%20Glenn%20Kimball%20-%20Egypt%20Illinois%20Cave.mp3",
  "fileSize": 100935721,
  "title": "Coast to Coast AM - Egyptian Cave in Illinois",
  "artist": "Art Bell",
  "airDate": "2001-11-26",
  "guestName": "Glenn Kimball",
  "showType": "coast",
  "topic": "Egyptian Artifacts Illinois",
  "duration": 8308.86,
  "format": "mp3",
  "source": "archive",
  "sourceUrl": "https://archive.org/download/ultimate-ultimate-art-bell-collection/2001-11-26%20-%20Coast%20to%20Coast%20AM%20with%20Art%20Bell%20-%20Glenn%20Kimball%20-%20Egypt%20Illinois%20Cave.mp3",
  "archiveIdentifier": "ultimate-ultimate-art-bell-collection",
  "aiSummary": "Researcher Glenn Kimball discusses claims of an Egyptian-style cave system discovered in Illinois, suggesting ancient trans-oceanic contact and challenging conventional archaeological narratives about pre-Columbian America.",
  "aiTags": [
    "archaeology",
    "ancient-mysteries",
    "egypt",
    "alternative-history",
    "artifacts"
  ],
  "aiStatus": "completed",
  "aiCategory": "Ancient Mysteries"
}
```
