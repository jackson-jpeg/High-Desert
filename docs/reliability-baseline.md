# Reliability baseline — the playback correctness release

**Release deployed:** `2026-09-24T14:57:23Z` (75e00c3)

`highdesert-status` reads the line above and prints a `release` line: the
failed-start rate over the seven days from that instant
(`/api/stats/failures?since=`). **Target: under 3%.** It WARNs at 3% or more
and never FAILs. A trailing 7-day rate can't judge a deploy, because for the
first week it still includes the old build's failures.

## Before

Measured at 2026-09-21T16:02:22Z over the trailing 7 days, on the build this release
replaced (8dace44):

| | |
|---|---|
| Failed starts (advisory kinds excluded) | 15 |
| Plays (`play_events`, = traffic `playsInRange`) | 301 |
| **Rate** | **5.0%** |
| Recovered by the retry | 1 |
| Retry skipped (no user activation) | 6 |
| Retried and still failed | 8 |
| Distinct episodes | 12 |

That figure **includes phantom HD-003 rows**. Before this release:
- If a listener picked a new show while the last one was still loading, the old
  `play()` promise rejected with `AbortError` and was recorded as a failure.
- The queued `abort` event fired after the new start began, so it was charged to
  the new show as a `network-error`.

Neither was a failed start. Part of the drop from this baseline is therefore
measurement, not reliability. That is expected, and it is why the target is a
rate and not a delta.

## After — release line readings

Each session records what `highdesert-status` printed for `release`.

| When (UTC) | Release line |
|---|---|
| 2026-09-21T16:11Z | `OK release no plays yet since the release (2026-09-21T16:03:19Z); target <3%` |
| 2026-09-22T14:03Z | `OK release 2.5% of starts failed in the 0.9 of 7 days since 2026-09-21T16:03:19Z (1 failures / 40 plays; target <3%)`. The one failure is a genuine mid-play `stall` 423 s into a show on desktop-chromium, retry skipped for want of a gesture — not a phantom |
| 2026-09-24T08:22Z | `WARN release 4.0% of starts failed in the 2.6 of 7 days since 2026-09-21T16:03:19Z (6 failures / 151 plays; target <3%)` — the closing reading for the c2d25a8 release, above target. All six are one-per-episode and five are `ios-safari`: three `stall` and three `play-rejected`, with four recording `retried: false` (no user activation, so the retry was correctly skipped rather than tearing down a live element). No episode failed twice for the same reason and the 7-day rate stayed at 4.8%, under the 5.0% baseline, so this is the iOS activation floor rather than a regression — but it is over 3%, and the target is the target. Next release's line starts from 304d05c |
| 2026-09-24T15:08Z | `OK release 0.0% of starts failed in the 0.2 of 7 days since 2026-09-24T08:07:11Z (0 failures / 17 plays; target <3%)` — the closing reading for 304d05c's line, and **17 plays is not enough to judge anything**. It is recorded as what was printed, not as evidence the release is clean; the c2d25a8 line only crossed 3% at 151 plays. Next release's line starts from 75e00c3 (the data-safety and stats-integrity release: HD-009, HD-010, HD-025, HD-015, HD-007, HD-008, HD-038, HD-042), and needs a week before it means anything |

## Android "code=4 MEDIA_ELEMENT_ERROR: Format error"

These are every `android-*` row in `playback_failures` whose `detail` is
`code=4 … Format error`: 49 rows across 35 episodes, first on
2026-08-04 and last on 2026-09-11. Format and bitrate come from archive.org's own
file metadata (`/metadata/ultimate-ultimate-art-bell-collection/files`). Bitrate
is the average (size × 8 ÷ length), because a VBR file has no single nominal
bitrate. "Plays" counts all-time `play_events` from every browser.

| Air date | Episode | Rows | Kinds | Format | kbps | Plays |
|---|---|---|---|---|---|---|
| 2003-05-29 | Coast to Coast AM - Cosmology and Consciousness | 5 | play-rejected | VBR MP3 | 32 | 17 |
| 1996-08-21 | Coast to Coast AM - Life on Mars | 4 | play-rejected | VBR MP3 | 24 | 10 |
| 1992-12-12 | Coast to Coast AM - Area 51 | 2 | play-rejected | VBR MP3 | 24 | 27 |
| 1995-03-12 | Dreamland - The Hidden History of the Human Race | 2 | play-rejected | VBR MP3 | 32 | 4 |
| 1995-07-09 | Dreamland - Alien Autopsy Film with Linda Moulton Howe and Greg Long | 2 | play-rejected | VBR MP3 | 96 | 2 |
| 1999-03-18 | Coast to Coast AM - Children's Past Lives | 2 | play-rejected | VBR MP3 | 24 | 0 |
| 2000-02-08 | Coast to Coast AM - Ghostly Communications | 2 | play-rejected | VBR MP3 | 32 | 0 |
| 2006-08-12 | Coast to Coast AM - The Growing Earth | 2 | network-error, play-rejected | VBR MP3 | 48 | 5 |
| 2006-10-22 | Coast to Coast AM - Consciousness and Water | 2 | play-rejected | VBR MP3 | 48 | 0 |
| 1993-06-20 | Coast to Coast AM - Philadelphia Experiment | 1 | play-rejected | VBR MP3 | 128 | 37 |
| 1995-02-05 | Dreamland - Prophecies and Predictions | 1 | play-rejected | VBR MP3 | 32 | 7 |
| 1995-03-05 | Dreamland - Tesla Technology | 1 | play-rejected | VBR MP3 | 32 | 2 |
| 1995-08-21 | Coast to Coast AM - Junk Mail Check Fraud | 1 | play-rejected | VBR MP3 | 24 | 4 |
| 1995-08-22 | Coast to Coast AM - Open Lines | 1 | play-rejected | VBR MP3 | 32 | 1 |
| 1995-09-20 | Coast to Coast AM - Revelations and End Times | 1 | play-rejected | VBR MP3 | 32 | 3 |
| 1996-04-03 | Coast to Coast AM - Open Lines on Roswell Fragments & The Quickening | 1 | play-rejected | VBR MP3 | 128 | 2 |
| 1996-04-16 | Coast to Coast AM - Open Lines Bizarre Stories | 1 | network-error | VBR MP3 | 64 | 3 |
| 1996-07-01 | Coast to Coast AM - Open Lines | 1 | play-rejected | VBR MP3 | 32 | 3 |
| 1997-12-03 | Coast to Coast AM - Father Malachi Martin | 1 | network-error | VBR MP3 | 32 | 6 |
| 2000-01-18 | Coast to Coast AM - HAARP with Nick Begich | 1 | play-rejected | VBR MP3 | 32 | 0 |
| 2001-04-13 | Coast to Coast AM - Ghost to Ghost | 1 | network-error | VBR MP3 | 24 | 2 |
| 2001-08-10 | Coast to Coast AM - Predictions and Remote Viewing | 1 | play-rejected | VBR MP3 | 32 | 0 |
| 2001-09-11 | Coast to Coast AM - September 11th Coverage | 1 | play-rejected | VBR MP3 | 32 | 33 |
| 2001-10-19 | Coast to Coast AM - Open Lines on Mass Consciousness Experiment | 1 | play-rejected | VBR MP3 | 24 | 0 |
| 2002-11-20 | Coast to Coast AM - The Future of the Internet | 1 | play-rejected | VBR MP3 | 24 | 1 |
| 2003-06-26 | Coast to Coast AM - Remote Viewing | 1 | play-rejected | VBR MP3 | 32 | 0 |
| 2003-09-20 | Coast to Coast AM - Extreme Weather | 1 | play-rejected | VBR MP3 | 32 | 4 |
| 2004-03-13 | Coast to Coast AM - Vision of Tribulation | 1 | play-rejected | VBR MP3 | 24 | 0 |
| 2005-01-01 | Coast to Coast AM - Remote Viewing | 1 | play-rejected | VBR MP3 | 32 | 0 |
| 2005-01-30 | Coast to Coast AM - Nephilim and the Apocalypse | 1 | play-rejected | VBR MP3 | 32 | 0 |
| 2005-06-11 | Coast to Coast AM - Nuclear Weapons and Pacific Adventure | 1 | play-rejected | VBR MP3 | 48 | 0 |
| 2013-10-01 | Special - Communion and NASA with Whitley Strieber and Richard C. Hoagland | 1 | play-rejected | VBR MP3 | 48 | 4 |
| 2013-10-10 | Special - Open Lines | 1 | play-rejected | VBR MP3 | 48 | 6 |
| 2013-10-23 | Special - Biological Terrorism Threats | 1 | play-rejected | VBR MP3 | 48 | 5 |
| 2013-10-30 | Special - Night Terrors and Dream Phenomena with Michael and Nicole Sebastian | 1 | play-rejected | VBR MP3 | 48 | 17 |

**Diagnosis.** This is not a format problem, and none of these episodes should
be pulled.
- Every file is an ordinary VBR MP3 at 24–128 kbps (median 32). That matches the
  catalog as a whole: all 1,318 originals are VBR MP3, with p10/p50/p90 of
  24/32/64 kbps.
- Probing the first 400 KB of each file with ffprobe found sample rates (8–48 kHz)
  and channel layouts in the same mix as a random 60-episode control set. All 35
  decode as standard MP3 today.
- 24 of the 35 episodes have been played successfully, some dozens of times
  (Philadelphia Experiment 37, September 11th 33, Area 51 27).
- The identical message appears 16 times on desktop Chromium, so it is not
  Android-specific either.
- Chromium raises `MEDIA_ERR_SRC_NOT_SUPPORTED` / "MEDIA_ELEMENT_ERROR: Format
  error" when a resource fails before any media data arrives. That includes a
  fetch that errors or is abandoned partway through archive.org's 302 to a
  datanode, not only a file it cannot parse.

The shape of the rows fits that reading. 45 of the 49 are `play-rejected`,
`retried: true`, with an `elapsed_ms` of 6–12. Each one is the watchdog's
immediate retry, and its `play()` rejected almost at once. The `detail` is carried
over from the first error.

The rows come in bursts. On 2026-09-02, 9 Android rows across 6
episodes landed within 80 seconds, four of them for 2003-05-29. That is a listener
skipping from show to show while each start is torn down under the previous one:
the superseded-start path this release fixes (HD-003). The rest are consistent
with transient archive.org fetch failures.

For shows cached offline, a blob URL used to get the retry's cache-buster. That
made it an invalid URL and fails in exactly this way, and HD-032 removes it. The
row cannot tell us whether any of these starts came from the offline cache.

There has been one such row since 2026-09-02. The post-release data should be
read for new ones before anything in the catalog is changed.
