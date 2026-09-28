# iOS stalls and the Philadelphia Experiment file

Written 2026-09-28. The question: 14 of the 17 most recent playback failures
were one episode, **1993-06-20, Al Bielek, "Philadelphia Experiment"**. Is
there something wrong with the file, most likely its VBR/Xing header, that
makes iOS stall? If so, the fix would be a losslessly repaired copy from the
mirror, routed to iOS.

**Short answer: no. The file is clean, and the failures belong to the one
night the live station aired it.** They are the slot-change and failover
defects fixed in this release (`docs/handoff-2026-09-28-overnight.md`, items 1
and 3). No repaired copy is served, because there is nothing in the header to
repair.

The header scan of the whole catalog did find a real fault, in seven other
files. It had nothing to do with stalls. The catalog's durations for those
seven files were wrong, and the live station schedules by duration. That fault
is fixed (see "The catalog's durations").

## The file

Read from our pinned copy and walked frame by frame
(`scripts/measure-duration.mjs`):

| | Philadelphia Experiment | Typical clean episode |
|---|---|---|
| Size | **281,521,195 bytes (268.5 MiB)** | 30 to 130 MB |
| Runtime | **17,590.5 s (4 h 53 min)** | 2 to 3 h |
| Encoding | MPEG-1 Layer III, **CBR 128 kbps, 48 kHz** | mostly 22.05 kHz, 24 to 64 kbps |
| Header | LAME3.97 **"Info"** tag with a TOC | usually no tag at all (1,208 of 1,413) |
| Tag frames | 732,937, **exactly** the frames in the file (plus the tag frame) | |
| Tag bytes | 281,448,192, **exactly** the audio bytes | |
| ID3v2 | 72,875 bytes (cover art), no junk before the first frame | about 77.7 KB |
| Resyncs | **0**; one bitrate and one sample rate throughout | |

It is the largest file in the catalog and the only one over 256 MiB. The next
largest is 1999-12-31 at 235 MB. Nothing else about it is unusual. The CBR
48 kHz "Info" encoding is shared by 13 other three-hour shows, which had 15
plays and 0 failures in the same 30 days.

## Where the failures actually were

The live station aired it on the Pacific day 2026-09-26, from **04:34:25 UTC
until the day ended at 07:00:00 UTC** on 09-27, to 55 listeners. All 14 of
its rows among the 17 most recent failures (ids 536 to 549) fall inside that
window:

- **04:34:26 to :29, the slot boundary.** 5 rows in 4 seconds.
  - 3 × `play-rejected` (two iOS, one Firefox): the new show's `play()` was
    refused. This is item 1, and the station now hands over on the same
    element without pausing it.
  - 2 × `network-error` from archive.org (Firefox `Failed to open media`,
    Android `code=4 Format error`). Every tuned-in client asked for the same
    file in the same second. Both recovered on the mirror.
- **04:34 to 06:48, playback on iOS, screens off.**
  - 7 × `stall` and 1 × `timeout`. 6 of the 8 `recovered` by failover to the
    mirror.
  - The two that failed on the mirror (rows 541 and 545) are item 3. One was
    a failover nobody was waiting for, judged by a stall clock while iOS had
    paused loading. The other was a background `play()` that iOS held until
    the phone woke, when a frozen timer gave up. Both are fixed in the
    watchdog.
  - 1 × Android `network-error` at 06:48, recovered on the mirror.

Normalised over 30 days, the file's rate is 14 of 83 plays (16.9%) against
5.3% for clean files. But 55 of its 83 plays came from that one airing, the
night the station's handover was broken. Its older rows (12, in August, before
the 30-day window) are mostly Firefox `play-rejected`, from before the watchdog
fix, when every row was written by a watchdog that could not see
(CLAUDE.md, "A watchdog that cannot see must not report").

### From archive.org, directly

Range requests as iOS makes them, 2026-09-28:

| Range | Status | First byte |
|---|---|---|
| `bytes=0-` | 206 | 0.82 s |
| `bytes=100000000-` | 206 | 1.11 s |
| `bytes=200000000-` | 206 | 0.85 s |
| `bytes=270000000-` | 206 | 0.88 s |

The control (1993-10-30, 41 MB) answered 206 at 0 and 416 past its end, the
correct response. Deep offsets in the big file are served normally.

## Reproduction in the iOS Simulator

iOS 26.5, iPhone 16 simulator, Safari, playing through a same-origin harness.
The harness is the page in the working files, with its log posted back to the
VPS.

- **From archive.org:**
  - Started at 30:00, the way a mid-show tune-in seeks. It played to
    **1:13:06**, with **no `waiting` after the first `playing`** and no error.
  - The 42 `stalled` events are Safari's "the network fetch is idle" signal.
    Safari throttles the download once it has buffered ahead, so the buffer
    stayed about 75 minutes deep.
  - Wall-clock time ran about twice the audio time. The Mac's load average was
    40 to 97, and the simulated device was starved.
  - **The stall did not reproduce.**
- **From our pinned copy (`/mirror/…`):** see "Pinned copy run" below.

The screen-locked case cannot be simulated faithfully here: locking the
simulator (Device > Lock) did not change the page's `visibilityState`, so
nothing that depends on backgrounding could be observed.

## The rest of the catalog: the same fault?

`scan` = every one of the 1,413 files. Pinned ones were read from disk. The
rest were read with range requests to archive.org (the head up to 256 KiB past
the ID3 tag, plus the last 128 bytes), at most 2 requests a second.

**No other file shares the Philadelphia profile.** No other file is over
256 MiB, and none has a clean tag on a file that fails. The scan did find
these, none tied to failures:

| Class | Files | 30-day plays | Failures | Effect |
|---|---|---|---|---|
| **LAME "Info" tag that stops short of the file** | **7** | 4 | 0 | **Duration read from the tag is far too short.** Fixed in the catalog (below) |
| ffmpeg (Lavf54.62) "Info" (CBR) tag on VBR 48/56 kbps audio: Dark Matter, 2013-10-08 to 10-31 | 14 | 317 | 9 (2.8%) | Seeks use a CBR map of VBR audio, so a seek lands a little off. Duration is right (ffmpeg's frame count). Fails less than clean files |
| No tag, VBR audio | 2 (1998-09-17, 2001-01-09) | 5 | 0 | Duration is estimated from the first frame |
| "Xing" tag without a TOC | 1 (2001-11-26) | 0 | 0 | Seeks are linear in bytes |
| Junk between ID3v2 and the first frame | 100 (5 to 2,269 bytes) | | | Harmless: every decoder resyncs |

**Failure rate by duration** (30 days, all causes): under 2 h 2.3%, 2 to 3 h
6.2%, 3 to 4 h 3.7%, 4 h and over 16.7%. The last bucket is Philadelphia
(83 of its 84 plays). It says more about which show was on the air than about
length.

## The catalog's durations

Seven files carry a LAME3.96r "Info" tag written for a shorter recording than
the file now holds. The frames and bytes in the tag stop early, and the file
runs on at the same bitrate, with no splice and no resync. archive.org's
`length` was derived from the tag, and the catalog copied it:

| Air date | Catalog said | Frames walked | Real runtime |
|---|---|---|---|
| 1996-02-23 | 2,474.68 s | 183,132 | 4,783.86 s |
| 1998-01-13 | 2,597.80 s | 312,429 | 8,161.41 s |
| 1998-03-24 | 4,823.57 s | 237,925 | 5,710.20 s |
| 1998-12-14 | 7,033.08 s | 461,905 | 11,085.72 s |
| **1999-01-25** | **18.39 s** | 354,913 | **9,271.20 s** |
| 2000-03-31 | 2,045.78 s | 390,962 | 9,383.09 s |
| 2001-08-23 | 2,328.92 s | 164,409 | 4,294.77 s |

The live station builds its day from the catalog's duration and cuts each slot
at its end. On 25 January it would have aired **18 seconds** of a
two-and-a-half hour broadcast. The other six would have been cut off after
half an hour to two hours.

- **Fixed:** `public/seed/library.json` now carries the measured runtimes. Only
  those seven `duration` values changed. `data/duration-corrections.json` keeps
  what each was, and how it was measured.
- **None of the seven had been frozen into a live day yet.** Checked against
  `live_days`, 2026-09-11 to 09-27. Each one's day will be built from the
  corrected value.
- **Visitors who already have these rows keep the old durations locally**,
  because `reconcileLibrary()` is add-only. That affects only the library's
  duration column. Playback runs to the end of the file regardless, and the
  live station uses the server's catalog.
- **Held by** `scripts/__tests__/measure-duration.test.ts`, with the mutations
  `measure-duration-skips-id3`, `measure-duration-in-step` and
  `catalog-measured-duration`.

No repaired copy of these files is served. Browsers play them to the end of
the file, and 0 of their 4 plays failed. Their bytes are what the torrents
(`data/torrents/episodes.json`) verify, so a rewritten header would also need
a second set of pins beside the verified ones. It is worth doing only if a
listener hits the wrong duration in the element itself.

## Re-running

- Header scan: `scripts/audit-durations.mjs` is the committed sweep of the
  catalog for empty files. The header classification above was a one-off in
  the working files. It adds tag fields to the same range-request approach.
- Runtime of any file: `nice node scripts/measure-duration.mjs <url-or-path>`.
