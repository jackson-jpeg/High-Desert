# High Desert handoff, 2026-10-11 (branch `session/2026-10-11-archive`)

Status: **in progress.** This file is rewritten as the session goes. The
"Left to do" section at the bottom is the truth about what is not done.

## Decisions carried out

- **Egyptian Cave (2001-11-26) is not pulled.** It is re-encoded once to mono
  44.1 kHz 64 kbps CBR by `scripts/repair-episode.mjs` and served from the
  mirror's `repaired/` directory, ahead of any pin. The original on archive.org
  is untouched. It is back in the catalog (1,413), `SEED_VERSION`
  `2026-10-11-b`, out of `REMOVED_FROM_CATALOG`, and logged in
  `docs/broken-episodes.md` under "Repaired, not pulled". The record in
  `src/data/repaired-episodes.json`:
  - original: 100,935,721 B, stereo for 0 to 2,639.33 s, then mono, 8,283.32 s;
  - copy: 66,266,927 B, one configuration, 8,283.32 s, sha256 `2d75fd7d…0442`.

  The player plays a repaired show from the mirror only (`resolveSources`), and
  so do a primed show and the radio's scan preview.
- **Archive moments.** Both Hale-Bopp moments now cite what `data/notable.md`
  cites: Exposing PseudoAstronomy's Chuck Shramek page, with Wikipedia's
  "Comet Hale-Bopp, UFO claims" in the `supports` text. I read both pages
  before writing. Each moment now says only what those pages say, so "of the
  Farsight Institute" and "pressed to name the source, he refused" are gone.
  "Ghost to Ghost 1993 is the earliest" is cut. 30 moments remain.

## 1. Lost starts, counted honestly

- One lost start per tab per show within 10 minutes (`LOST_START_GAP_MINUTES`).
  Repeats are shown beside the line, never added to it.
- A failure row now carries `tab_ref` (`FAILURE_TAB_ID`). This is a random id
  per page load, never the presence session, and never sent with a play.
  Older rows fall back to UA class plus build.
- The release line recomputed both ways is in `docs/reliability-baseline.md`
  ("One lost start per tab per show"):

  | Counting | Lost | Plays | Share |
  |---|---|---|---|
  | Every unrecovered row (before) | 57 | 1,329 | 4.3% |
  | One per tab per show (now) | 23 | 1,329 | 1.7% |

  The new count has 34 repeats. 33 of them are the Egyptian Cave burst. Under
  the 10-minute rule that burst is 2 losses, not 1, because it came in two
  waves (17:54 to 17:56, then 19:44).
- Tests: `store.db.test.ts`, `failure-tab.test.ts`, status and digest.
  Mutations: `failure-window-recovered`, `lost-start-gap`,
  `lost-start-per-tab`, `lost-start-tab-stored`, `lost-start-tab-sent`,
  `status-release-repeats`, `digest-release-repeats`. All went red.
- **Production needs `scripts/schema.sql` applied** for the `tab_ref` column.
  Until then, the insert of a failure row with a tab fails. This is part of
  the deploy below.

## 2. The mirror cut a full file at 13.6 MB

- **Cause:** archive.org's storage node answers about 3% of slice Range
  requests with a bare HTTP 500. nginx 1.24's slice module aborts the whole
  response on a non-206 subrequest. There were 22 such aborts in 14 days, 17
  of them on iOS.
- **Fix:** the fill upstream is the same unix socket three times
  (`max_fails=0`), with `proxy_next_upstream error timeout http_500 http_502
  http_503 http_504`, 3 tries in 30 s. The `FLAKY` test in
  `services/mirror/test/nginx.test.mjs` streams an unpinned file whose stub
  fails two slices once each. It passes only if the file arrives whole and
  each failed slice was asked for twice.
- **Android mirror timeouts: not explained by this.** Of 34 android-chrome
  mirror stall or timeout rows in 30 days, 22 fall inside the access-log
  window, and none of those 22 had a slice abort:
  - 10 never requested the mirror at all;
  - 8 were pins, served straight off disk;
  - 4 went through the fill with no errors.

  That points at the client (the failover path on Android), not nginx.
- **Finding, not changed: the fill cache keeps nothing.** Free disk (about
  6.9 GB) is below nginx's `min_free=12g`, so every slice is evicted as soon
  as it is written. There have been 1,079 "ignore long locked inactive cache
  entry" alerts. Unpinned shows are therefore always a fresh fill from
  archive.org.

## 3. The whole-catalog frame scan

`scripts/scan-catalog-audio.mjs` (resumable, `--concurrency`, pins read from
disk) is walking all 1,413 files, under heavy, `nice 19`, `ionice -c3`. It runs
from a frozen copy in `/root/hd-scan/bin`, and its results are in
`/root/hd-scan/scan.jsonl`. **Results: see "Scan results" below** (filled in
when it finishes).

## 4. The station guard

- **Pre-air walk:**
  - `scripts/verify-live-day.mjs` runs from `highdesert-verify-live.timer`
    (15:20 UTC, Nice=19, idle IO, CPUQuota=10%).
  - It walks the next Pacific day's on-this-date shows and its top 60
    favorites into `audio_checks`.
  - `frozenDay()` swaps out a file that failed (`verify-swap`) before storing
    the day.
- **Breaker:**
  - 3 distinct tuned-in clients failing on the show on the air within
    2 minutes cut it.
  - The cut is a `live_overrides` row, applied in every schedule read.
  - After one station ID, a walked favorite plays to the slot's old end.
- **Tuned-in tabs follow a changed slot** at the next minute's schedule read
  (`followChanges`). A held (paused) tab is left alone.
- **The digest** has a "Station guard" section: shows cut on air, shows kept
  off the air, and the walk's last run. It raises the walk under "Needs you"
  when it is stale past 36 h.
- Tests: `station-guard.test.ts`, `breaker.test.ts`, `live-days.db.test.ts`
  (verify swap and override against Postgres), the `live-station.test.ts`
  follow block, `verify-live-day.test.ts`, `digest.test.ts`,
  `breaker-feed.test.ts`, `on-the-station.test.ts`, `service-unit.test.ts`.
  20 mutations, all red: `live-follows-*`, `live-verify-*`,
  `live-override-cut`, `live-breaker-*`, `live-frozen-verify-swap`,
  `live-schedule-reads-overrides`, `preair-*`, `digest-station-*`,
  `breaker-fed-by-route`, `breaker-station-show-only`.

## 5. The encrypted backup

- `scripts/backup-offsite.sh`, leg 4 of the nightly `backup-db.sh`:
  - every kept dump is encrypted with age to `deploy/backup-age-recipient.txt`;
  - the set is force-pushed as one orphan commit to the **private** repo
    `jackson-jpeg/highdesert-backups`, so 14 days are kept and git keeps no
    history beyond them;
  - every run has a restore test: decrypt, compare the sha256, and check that
    `pg_restore --list` finds the permanent tables.
- **The private key is `/root/.high-desert-backup-age.key` on the VPS, and a
  copy is in this handoff's Mac folder. Put it in your password manager and
  delete that copy.** It is the only way into the GitHub copies if the VPS is
  lost.
- The first real push was 15 dumps, and its restore test passed.
- **Rehearsal from GitHub:**
  - cloned the repo, decrypted the newest copy, and its sha256 equalled the
    dump's;
  - restored it into a scratch database (dropped afterwards):
    `play_events` 5,720 against production's 5,854 at the time; the dump is
    22 h older.

  Full table in `docs/backup.md`.
- Tests: real age, with a local bare repo standing in for GitHub. The pushed
  copy is cloned, decrypted and restored, and the test row comes back.
  Mutations: `offsite-restore-compare`, `offsite-drops-pruned`,
  `offsite-no-history`, `backup-runs-offsite`. All went red.
- `age` was installed from Ubuntu's archive (`apt-get install age`). It is not
  one of the retired tools. CI installs it too (`ci.yml`, `mutations.yml`).

## 6. Firefox and NotSupportedError

`docs/firefox-notsupportederror.md`. In short:

- It is the same storage-node HTTP 500 as section 2. The 500 carries no CORS
  header, so every browser rejects `play()`, and Firefox names the rejection
  `NotSupportedError`.
- All 24 Firefox rows recovered on the mirror, and so did 79 of 79 such rows
  across all browsers.
- Ruled out: CSP, Content-Type, crossOrigin and the codec.
- A `NotSupportedError` row now carries the element's own `MediaError`
  (mutation `play-rejection-media-error`).

## Archive moments cut on 2026-10-11 (the list `docs/live-chat.md` points to)

The 1b3055e session cut these 19 and recorded only the general reason: no
public page dated the event, the people and the show, and in most cases only
uploads and fan listings did. Its reason for each one was not written down.
The 20th, `ghost-to-ghost-1993`, was cut today on review.

area-51-line, lazar-lear, glenn-campbell, alan-hale, phoenix-analysis,
time-traveler-line, hoagland-mars, hoagland-count, howe-mutilations,
howe-crop-circles, brinkley, gary-north-y2k, malachi-martin, quickening,
open-lines, morton-predictions, ramona, resignation-1998, archive-span,
ghost-to-ghost-1993.

## Hook blocks this session

Every one was the pipefail hook (`require-pipefail.py`). Each time I re-ran the
same command with `set -o pipefail;` in front, and nothing else changed:

1. `git log | head`
2. `find | grep`
3. `df | tail`
4. `cat | grep`
5. a `kill` command line that contained a pipe
6. `cat <task output>; ps aux | grep …`. Re-run without the pipe, through a
   file.

The parallel investigation agents hit 4 and 7 pipefail blocks of their own and
handled them the same way. The macOS hook did not block anything.

Two other incidents:

- A `pkill -f` killed my own shell, because the pattern was in my own command
  line. I kill by PID now.
- A `createdb` with no password prompted in a loop in the background. I killed
  it by PID and created the scratch database as the postgres user instead.

## Left to do

(Updated as the session continues.)
