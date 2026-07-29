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
