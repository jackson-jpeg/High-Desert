# Reliability baseline — the playback correctness release

**Release deployed:** `2026-09-28T14:49:18Z` (02db307)

`highdesert-status` reads the line above and prints a `release` line over the
seven days from that instant (`/api/stats/failures?since=`). **Its headline is
the starts the listener lost**: failed starts that neither the retry nor the
mirror got playing, over plays. **Target: under 3%.** It WARNs at 3% or more
and never FAILs. A trailing 7-day rate can't judge a deploy, because for the
first week it still includes the old build's failures.

**Rescued starts stand beside it** as `N rescued by the retry or the mirror`,
with their own count (and share, from 300 plays), in status and in the weekly
digest. They are still failure rows (`recovered: true`), still in
`/api/stats/failures`, and still evidence when a release is investigated, but
the listener heard the show, so they are not held to the target.

**Under 300 plays the line gives counts, never a percentage**: `2 starts lost
in 55 plays on this release's builds so far, no verdict until 300 plays`. A
share of a few dozen plays reads as a verdict it is not (one failure on one
play is "100%"). From 300 plays it leads with the share: `1.0% of starts lost
… (3 lost / 300 plays; target <3%); 17 rescued by the retry or the mirror
(5.7%)`. The digest follows the same rule, and gives the verdict at 300.

## The headline changed on 2026-09-28

Until 2026-09-28 the headline counted every failed start, rescued or not
("4.4% of starts failed"). From 2026-09-28 (the commit that changed
`scripts/status.sh`, `scripts/digest.mjs` and `getFailureWindow`, which now
returns `recovered` per build) it counts only the starts the listener lost.
The target (3%) and the verdict rule (300 plays) did not change; what they
are applied to did.

The current line, recomputed both ways once, from the rows at 2026-09-28T21:08:56Z
(release 02db307 and its deploys since; 15 plays on untagged rows, no failures,
counted apart either way):

| | Failures | Of them rescued | Plays | Line |
|---|---|---|---|---|
| Before (every failure) | 3 | (counted as failures) | 55 | `5.5% of starts failed … (3 failures / 55 plays, 55 of 300 for a verdict)` |
| After (lost; rescued beside) | 2 lost | 1 rescued (row 585: an iOS stall the mirror played) | 55 | `2 starts lost in 55 plays … so far, no verdict until 300 plays; 1 rescued by the retry or the mirror` |

The two lost starts are rows 586 and 587 (build 961c244): failovers where
archive.org failed first and then the mirror failed too.

**This moves at least one past verdict.** The closing reading for b2feecc
(the table below, 2026-09-28T06:48Z) was 49 failures on 1,126 plays, 4.4%,
over target. 31 of the 49 were rescued, so the listener lost 18: **1.6%,
under target** by the new headline. That release is not re-judged here, and
its row below stays as printed. It is the size of the difference: on that
week, most failures were ones the retry or the mirror had already absorbed.

**Counted by the build that wrote each row** (from the long-lived tabs
release on). Every play (`play_events.build`) and failure
(`playback_failures.build`) carries the build of the page that sent it: its
`<meta name="hd-build">`, the short SHA `deploy.sh` built (`src/lib/utils/build-id.ts`).
The line counts only rows from **this release's builds**: the commit on the
line above, plus every build `deploy.sh` recorded in `.deploy/history` at or
after the release instant (a docs deploy is a new build of the same release).
Rows from any other build, or with none (written before the column existed,
or by a page that could not say), are printed beside it as `older builds: X
lost, R rescued / Y plays, counted apart`, never dropped and never mixed in. That is
what a tab left open for days on older code used to do to this line: on
2026-09-28 four of the first eight failures after 15144c1 came from one such
tab. Tabs now update themselves at a break (`src/services/build/stale-tab.ts`),
so the older-builds figure should fall to nothing within a day of a deploy.

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
| 2026-09-25T01:03Z | `OK release 0.0% of starts failed in the 0.4 of 7 days since 2026-09-24T14:57:23Z (0 failures / 32 plays; target <3%)` — the closing reading for 75e00c3's line. As with 304d05c's line, **32 plays is too few to judge a release**; recorded as printed, not as evidence the release is clean. Next line starts from b2feecc: the archive.org outage fallback (#19), which changes the play path — failover to `/mirror/` on `network-error`/`stall`/`timeout`, the failover spending the retry, and the health verdict cached 30 s when down. A failover that rescues a start is recorded with `recovered: true`, so it counts in this rate the same way a successful retry does |
| 2026-09-28T06:48Z | `WARN release 4.4% of starts failed in the 3.2 of 7 days since 2026-09-25T00:30:52Z (49 failures / 1126 plays; target <3%)`: the closing reading for b2feecc's line, above target on enough plays to mean it. 31 of the 49 recovered (the retry or the mirror got the show playing) and count here by design. 14 of the 49 fell in one night: 2026-09-27 04:30 to 07:30 UTC, when the station aired the Philadelphia Experiment to 55 listeners and phones with the screen off failed at the slot change (`play-rejected`) and in failovers that did not recover while the page was hidden (`docs/ios-stalls.md`). Next line starts from 15144c1, the overnight reliability release (#41): the slot change on one never-paused element, `handover-rejected` as its own counted kind (it stays on this line), the hidden-page failover fixes, pins first, and the 1,413-episode catalog |
| 2026-09-28T14:52Z | `WARN release 13.3% of starts failed in the 0.3 of 7 days since 2026-09-28T06:46:22Z (15 failures / 113 plays; target <3%)` (computed from the rows at the swap; the last reading status printed was 14.1%, 13 / 92): the closing reading for 15144c1's line, and 113 plays is not a verdict. Of the 15, **7 recovered** (the mirror got the show playing) and count by design. **4 came from one tab on code older than 15144c1** (rows 574 to 577: `play-rejected` with an empty detail, which only pre-4490dcc code writes, one Android tab, one show, 8 seconds). That tab is why rows now carry their build. The rest: stalls and timeouts after a failover (572, 573, 581) and an Android `code=4 Format error` that the mirror did not rescue (584). Next line starts from 02db307, the long-lived tabs release (#43): tabs update themselves at a break, every row names its build, and this line counts only this release's builds |

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
