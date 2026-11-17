# Two-pass Level: status (2026-11-16)

**State:** merged to main (380d61d), Clean up still hidden. Deploy in the
morning window (about 09:30 UTC, 2026-11-17) with a station notice. The
production check (one show with an envelope, one without) follows the
deploy and is recorded at the end of this file.

## What changed

The live leveler only knew the past, so every tuning traded the talker
swing against breathing in the pauses. Level is now two-pass:

- **Server:** `highdesert-level-envelopes.timer` (hourly, each episode in
  the `heavy` slot, `CPUQuota=10%`, `Nice=19`, idle IO) runs one ffmpeg
  `ebur128` pass per episode and stores the gain envelope in
  `level_envelopes` (int8, 0.25 dB steps, 10 a second, about 80 KB for a
  2.25 h show). **Loudness numbers only; no audio is stored.** Order:
  today's and tomorrow's station, then by plays, then the rest. archive.org
  at 1 MB/s, one file at a time; pins and repaired copies read from disk.
- **Browser:** `GET /api/level/envelope?key=<communityKey>` (binary, cached
  a day). A GainNode before the worklet follows the envelope, scheduled
  against the element's position and laid again on timeupdate, seek, rate
  change, play and pause. The worklet's AGC and compressor step aside; its
  -1 dBTP limiter stays. No lookahead, no added delay: the live station
  stays in sync. A show with no envelope yet keeps the live leveler
  (`data-level-source="live"`); onset mode is gone.
- **Swing on talk only** (your decision): `talkerSwing` is `talk_swing`
  from metrics.py. No other target changed.

## Your envelope.py, and two steps of mine after it

`gainEnvelope` is an exact port of `gain_envelope` (max difference
5e-15 dB on five clips; held in `level-envelope.test.ts` against your
script's own output on two). **On its own it passed 32 of 34**: in a gap
of 0.25 to 0.65 s after a talker, too short for 400 ms frames to read as
a pause, the gain kept moving toward the next talker, and the floor rose
+1.25 dB (worst-2001-09-11) and +1.72 dB (hiss-2000-03-31b) against 1 dB.

I added two steps (`levelEnvelope`). Each can only lower the gain, so peaks
and pauses only improve and the 24 dB/s slew still holds:

1. **Gap hold:** where loudness dips 8 dB below the loudest frame within
   0.5 s, the gain may not rise; it catches up at the slew limit after.
2. **Late rise:** each frame takes the lowest gain of the last 0.3 s, so
   a cut still starts before a loud caller, a lift waits for the talker.

How 0.3 s was chosen, all 34 clips each time:

| Setting | Fails |
|---|---|
| prototype alone | pause, worst-2001-09-11 (+1.25) and hiss-2000-03-31b (+1.72) |
| late rise 0.5 s alone | pause, hiss-2000-03-31b (+1.47); swing, hiss-2001-02-14 (0.54) |
| gap hold alone | pause, worst-2001-09-11 (+1.10) |
| hold + 0.2 s | pause, worst-2001-09-11 (+1.05) |
| hold + 0.5 s | swing, hiss-2001-02-14 (0.55) |
| **hold + 0.3 s** | **none** |

**Thin margins:** hiss-2001-02-14's swing ratio is 0.50, exactly the
line; the fastest gain move is 27.8 dB/s against 30. If you would rather
not carry steps beyond your prototype, the alternative is to look again
at those two clips' gaps; I did not loosen any target.

## The 34 clips (Level, two-pass, final)

Swing in dB (talk only) in -> out (ratio, target <= 0.5 above 3 dB in,
no worse below); TP dBTP (<= -1); gain rate dB/s up/down (<= 30); pause
lift dB (<= 1); output LUFS.

| Clip | Swing | TP | Rate | Pause | LUFS |
|---|---|---|---|---|---|
| worst-1999-03-10 | 8.9 -> 1.1 (0.12) | -5.0 | +20.9/-13.1 | 0.00 | -18.2 |
| worst-2002-10-03 | 9.8 -> 0.9 (0.09) | -1.9 | +26.6/-24.6 | 0.00 | -18.3 |
| worst-1995-03-19 | 11.8 -> 1.0 (0.09) | -3.3 | +24.8/-18.7 | 0.00 | -18.3 |
| worst-2001-06-12 | 8.9 -> 1.1 (0.12) | -3.7 | +27.8/-27.8 | 0.20 | -18.2 |
| worst-1998-02-05 | 3.6 -> 0.7 (0.21) | -3.9 | +5.1/-27.7 | 0.00 | -18.2 |
| worst-2001-09-11 | 7.9 -> 1.6 (0.20) | -1.3 | +18.9/-24.7 | 0.85 | -18.2 |
| worst-2004-04-25 | 5.9 -> 1.5 (0.26) | -2.7 | +16.0/-13.1 | 0.25 | -18.3 |
| worst-1997-01-27 | 9.7 -> 1.7 (0.17) | -1.3 | +16.0/-21.6 | -0.35 | -18.4 |
| cleanest-2006-11-12 | 1.6 -> 0.8 | -1.3 | +13.2/-10.4 | 0.25 | -18.1 |
| cleanest-1998-01-27 | 2.5 -> 0.9 | -5.6 | +12.8/-16.0 | 0.52 | -18.1 |
| typical-1997-07-11 | 4.3 -> 1.3 (0.31) | -4.0 | +18.9/-18.7 | 0.31 | -18.2 |
| typical-2001-03-15 | 1.6 -> 0.7 | -3.6 | +5.1/-10.4 | 0.25 | -18.0 |
| typical-1996-12-29 | 4.4 -> 0.8 (0.19) | -5.0 | +2.5/-5.1 | 0.00 | -18.2 |
| typical-1998-02-02 | 2.2 -> 0.9 | -3.8 | +13.2/-15.9 | 0.00 | -18.1 |
| caller-guest-1998-12-01 | 4.5 -> 1.5 (0.34) | -1.8 | +24.1/-27.7 | 0.44 | -18.3 |
| dead-air-1999-06-16 | 5.8 -> 1.4 (0.24) | -1.3 | +27.8/-24.7 | 0.49 | -18.4 |
| hummy-1997-08-10 | 1.3 -> 0.8 | -3.4 | +5.1/-2.5 | 0.00 | -18.1 |
| hiss-1992-12-12a | 1.0 -> 0.5 | -8.9 | +2.5/-2.5 | 0.00 | -18.1 |
| hiss-1992-12-12b | 0.8 -> 0.3 | -9.5 | +2.5/-2.5 | 0.00 | -18.0 |
| hiss-2001-02-14 | 3.3 -> 1.7 (**0.50**) | -4.9 | +15.3/-7.7 | 0.00 | -18.4 |
| hiss-2000-03-31a | 2.1 -> 0.9 | -4.8 | +7.7/-2.5 | 0.79 | -18.1 |
| hiss-2000-03-31b | 2.1 -> 1.2 | -4.6 | +18.1/-2.5 | 0.50 | -17.8 |
| hum-1996-05-10a | 3.1 -> 1.2 (0.38) | -2.4 | +10.4/-5.1 | 0.00 | -18.3 |
| hum-1996-05-10b | 3.3 -> 1.4 (0.43) | -2.7 | +7.7/-5.1 | 0.00 | -18.3 |
| swing-1995a | 11.8 -> 1.0 (0.09) | -3.3 | +24.8/-18.7 | 0.00 | -18.3 |
| swing-1995b | 9.9 -> 1.1 (0.11) | -1.3 | +7.6/-24.6 | 0.51 | -18.2 |
| bumper-1995-08-24 | 2.5 -> 0.6 | -5.6 | +2.5/-2.5 | 0.08 | -18.1 |
| bumper-1998-06-15 | 3.0 -> 0.4 (0.12) | -3.2 | +2.5/-2.5 | 0.00 | -18.1 |
| bumper-2002-01-07 | 1.5 -> 0.7 | -6.4 | +5.0/-16.0 | 0.00 | -18.0 |
| bumper-2008-12-18 | 1.8 -> 0.8 | -1.3 | +7.6/-13.1 | 0.00 | -18.1 |
| music-1994-11-13 | 2.7 -> 0.4 | -5.2 | +2.5/-5.1 | 0.00 | -18.1 |
| music-1997-09-26 | 3.0 -> 1.1 (0.38) | -2.9 | +5.1/-18.7 | -0.89 | -18.1 |
| music-1999-09-07 | 4.8 -> 1.1 (0.23) | -2.1 | +16.0/-13.2 | 0.25 | -18.1 |
| music-2001-05-09 | 2.6 -> 0.4 | -5.8 | +2.5/-2.5 | 0.00 | -18.1 |

Reproduce: `node scripts/audio/evaluate.ts <testset.json> --level-only`
(`--live` scores the fallback leveler).

## Checks (all on the VPS, through heavy)

- lint, typecheck: clean.
- vitest, full suite with the test database: 3,233 passed, 1 failed:
  `sponsors.test.ts`, a station-break spot measured 20.64 s against a
  20 s ceiling. **From main** (3e3743e, 2026-11-09), not this change;
  spots are off the air, so I left it for you.
- mutations, everything the branch touches (`--changed-from main`): all
  red after fixes. Two of my tests were too weak at first (the gap hold,
  talk-only swing) and were sharpened; three anchors were stale and were
  refreshed, **two of them stale on main already** (`live-bridge-never-pauses`,
  `live-bridge-from-the-top`: station breaks rewrote `playBridge`).
- build: clean. **Next.js 16.4.3 stopped the first build once with a
  "known security vulnerability" upgrade notice**; a retry built. Not
  upgraded: a dependency change is your call.
- check:seo clean; check:csp clean but for `/live-api/*` 404s (the chat
  service is not run locally).
- e2e `dsp-player` and `dsp-render`: Chromium desktop and mobile 22/22,
  WebKit desktop and iPhone 12 passed, 3 skipped (no processing on iOS by
  design). New case: a show with an envelope reports `envelope`, one
  without reports `live`, both processed and playing.

## Production so far

- `level_envelopes` created by hand from `scripts/schema.sql` (idempotent;
  the deploy will find it applied).
- `highdesert-level-envelopes.timer` installed and enabled. First run
  22:19 UTC: 2003-11-16 (today's on-this-date show, 2.9 h) from archive.org
  in 238 s, -15 LUFS integrated.
- Sizing: a 2 h 15 min pin is 25 s of CPU, 55 MB RSS.

## 2026-11-17: the reboot, and your three Inbox answers

- **The box was rebooted about 00:45 UTC** for KVM 4 (4 cores, 16 GB,
  200 GB). Site, station, chat and stats export came back by themselves; no
  play was lost (last one logged 00:44). Station notice posted 00:53 UTC
  with your approved wording (the upgrade, an apology, thanks to donors).
- **The two steps after `envelope.py`: approved, both kept.** No change.
- **Next.js 16.4.6: approved, done** (GHSA-mfr8-8qww-v76h, moderate,
  16.3.0 to 16.4.4; nothing in `src/` uses `unstable_cache` or
  `'use cache'`). Only `next` moves in the lockfile. `eslint-config-next`
  stays at 16.3.8: 16.4.6 pulls in react-hooks rules that fail 11 places in
  `src/`, a change of its own. Checks on the branch: lint, typecheck, vitest
  3,237 passed (335 files, 0 failed), build with no security notice,
  check:seo clean, check:csp clean but for the local `/live-api` 404s. No
  e2e run; `deploy.sh` verifies and rolls back.
- **The Sim Sunday spot: re-rendered at 19.49 s** (was 20.64), ceiling
  still 20. Cut "live," and "and do it again". One Piper render, **not
  transcribed**: Whisper is not on this box any more, so nobody has
  checked the take word for word. Spots are off the air.
- **Hook block:** the npm hook refused one call (`cd` to the worktree
  after a `;`, then `npm ci`). Nothing ran; re-issued as `cd <worktree> &&
  npm ...`, the form the block names.
- All three ship with Level in the morning deploy.

## For the next session (written 2026-11-17 03:30 UTC, before a /clear)

Nothing is running in-session and nothing is half done. Main is clean and
pushed. One job is owed: **the morning deploy, about 09:20 UTC today.**

1. `highdesert-status` (the `deploy` line reads DRIFT until this is done;
   that is expected), `heavy status`.
2. `cd /root/High-Desert && bash scripts/deploy.sh`. It ships Level
   (two-pass), Next.js 16.4.6 and the shorter Sim Sunday spot. The lockfile
   changed, so it installs in its staging copy. `level_envelopes` is already
   applied. It verifies and rolls back by itself.
3. Post a station notice announcing Level (`POST /live-api/admin/notice`,
   token in `/root/.high-desert-live.env`, at most 500 characters, no em
   dashes): there is a Level switch in the player on desktop and Android
   that evens out loud and quiet callers; not on iPhone.
4. On production, check one show with an envelope reports
   `data-level-source="envelope"` and one without reports `live`
   (`select community_key from level_envelopes` for the first kind), and
   record it at the end of this file.
5. `npm run check:seo -- https://highdesert.space` and `check:csp`, then
   copy this file to the Mac folder again
   (`~/Downloads/high-desert-2026-11-16-audio-cleanup/`).

Known and not to chase:
- **No timer will wake a session at 09:20.** The in-session wait was
  stopped at 03:17 UTC when the box ran low on memory (sang3r.com's build
  held 6 GB; not High Desert). Jackson has not asked for it to be set
  again, so the deploy starts when he or a session says so.
- The `warm` line WARNs "stopped at floor" from before the disk grew; the
  04:10 UTC run should clear it.
- The Sim Sunday take has not been transcribed (no Whisper on the box).
- `eslint-config-next` stays at 16.3.8 on purpose (see above).
- `/root/hd-audio` (branch `audio-cleanup`, at 3e363bd, clean) is kept for
  Clean up, which is still held back.
- Hook blocks this session: the npm hook once (above), and the pipefail
  hook once (a pipe inside an `ssh` command; re-issued without it).

## Deployed 2026-11-17 15:22 UTC (`9474f79`)

Jackson approved deploying ahead of the window. `deploy.sh` passed the client
check and the returning visitor (Chromium, WebKit); `highdesert-status` exits
0 (deploy OK; steal WARN at 24%). `check:seo` and `check:csp` against
production pass. Level on production: `/api/level/envelope` gives 200 for
1992-12-12 (an envelope) and 404 `none` for 1994-03-12 (none yet, so the live
leveler); 101 envelopes stored. The `data-level-source` attribute was not read
in a browser, so no play was counted on production. Station notice posted
15:24.
