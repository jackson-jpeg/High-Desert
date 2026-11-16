# Level and Clean up

Two switches in the player, for listeners who asked for them (2026-11-15):

- **Level** evens out a quiet guest and a loud caller, and holds the whole
  station near one loudness.
- **Clean up** takes out rumble, mains hum and tape hiss.

Both run in the listener's browser, in an AudioWorklet, on the audio as it
plays. archive.org's files are never touched, nothing is re-encoded, and
nothing is hosted here. They should sound like a careful radio engineer
worked on the show, not like an app filter: a little hiss left is better
than a watery, underwater sound, and a pause stays a pause.

Level is on by default; Clean up is off. The choice is remembered per browser
(`localStorage["hd-dsp"]`).

**Clean up is built but held back** (`CLEANUP_RELEASED = false` in
`src/stores/processing-store.ts`, Jackson, 2026-11-15): it misses the hiss
floor target on the heaviest-hiss shows ("Clean up is held back", below).
Its switch is not drawn, the store and the graph refuse it, and a choice
saved earlier never runs it. `localStorage["hd-dsp-preview"] = "cleanup"`
shows it in one browser, which is how the e2e specs test it. It ships on
its own, once it passes every target; the targets do not change.

## Where it runs

| | Level, Clean up |
|---|---|
| Desktop Chromium, Firefox, Safari | yes |
| Android (Chrome) | yes |
| iPhone, iPad (every browser: all are WebKit) | no: greyed, with a one-line reason |

**iOS never routes the player through Web Audio.** A media element routed
into an AudioContext stops when the phone locks (`src/audio/engine.ts`,
`src/audio/levels.ts`). The meters there use the level tap instead.

The graph (`src/audio/processing.ts`):

```
element ─ source ─┬─ worklet (Clean up, Level) ─ wet ─┐
                  └─ delay (the worklet's latency) ─ dry ┴─ analyser ─ volume ─ speakers
```

- The dry path is the same audio, delayed by exactly the worklet's latency,
  at zero gain. A worklet that fails to load, throws, or goes quiet hands
  over to it with no jump in time, and the switches grey out with the reason.
  Never silence.
- The listener's volume is after the processing; the analyser (every meter
  and visualizer) is before it, so the meters show what is heard.
- Both switches off: the worklet is a pure delay once its fades finish.
- The live station, the library, a cached (OPFS) show and a local file all
  play through the same element, so all are processed.

## The chain (`src/audio/dsp/`)

```
input ─┬─ Clean up (wet) ─┐                      ┌─ Level ─┐
       └─ delay N ────────┴ mix(cleanupMix) ─┬───┤         ├ mix(levelMix) ─ duck ─ out
                                             └─ delay L ───┘
```

One constant latency, whatever is switched on: about a quarter second (Level's
200 ms lookahead, the gate's 1,024 samples and the limiter's few ms). That is
well inside the live station's 2 s drift tolerance, and the meters read after
the processing, so they move with what is heard.
Every switch is a crossfade after the stage has warmed up unheard, so a
toggle never clicks; a seek or a new show ducks the output for the jump.

**Level** (`leveler.ts`, `compressor.ts`, `limiter.ts`):

1. A K-weighted loudness AGC steering to **−16 LUFS**: the last 3 s of
   *active* audio (pauses never drag it down), a fast path for a hot caller
   (momentary loudness may sit only so far above the target), rise slow and
   capped, fall fast, frozen in quiet (dead air and hiss are never pumped up),
   with lookahead so the fall begins as the caller does.
2. A gentle leveling compressor (soft knee, ~50 ms RMS, slow release), gated
   so the gain cannot recover in a pause: no breathing.
3. A lookahead true-peak limiter at **−1 dBTP** (4x oversampled detector).

**Clean up** (`cleanup.ts`, `hum.ts`, `denoise.ts`, `music.ts`):

1. High-pass, 4th-order Butterworth at **70 Hz**: rumble, handling, the
   transport. Voices start above it.
2. **Hum notches only when hum is found**: 50 or 60 Hz and harmonics, found
   in the pauses, each line notched (two in series, depth ramped, so no
   clicks), released with hysteresis. No hum, no filter at all.
3. **The hiss gate**: a short-time spectral gate (1024-point STFT, hop 256).
   (Described in full under "The hiss gate", below.)
4. The gate eases off while the music detector hears music, so a bumper keeps
   its cymbals ("Music").

## The archive survey

`scripts/audio/measure-archive.ts` measured **448 one-minute segments of
151 episodes** (12%, 47% and 82% of the way into each; 10 segments could not
be fetched) into `archive-survey.csv`. One request at a time, a Range read
each, a polite user agent. The episodes were spread across every year and
programme in the catalog.

| | p10 | p50 | p90 |
|---|---|---|---|
| Integrated loudness (LUFS, file as stored) | −21.0 | −16.5 | −12.8 |
| Short-term swing (dB) | 2.2 | 3.9 | 7.0 |
| Biggest 1 s step (dB) | 2.1 | 3.5 | 8.8 |
| True peak (dBTP) | −6.3 | −1.7 | +0.7 |
| Programme over noise floor (dB) | 11.6 | 31.5 | 43.9 |
| Codec cutoff (Hz) | 4,359 | 6,445 | 10,289 |
| Bitrate (kbps) | 24 | 32 | 64 |

- 331 of 448 segments swing 3 dB or more; 181 peak over −1 dBTP as stored.
- 230 of 448 are cut off under 7 kHz by the MP3 encoder, and 225 are 22 kHz
  files. Whatever hiss there is lives *under* the cutoff.
- 55 segments show two or more hum lines, 18 three or more.

## Metrics, and what each one can see

`src/audio/dsp/metrics.ts` and `targets.ts`. Every target is a function of
the original clip and its render, so a target means one thing in the unit
tests, the before/after table and the browser render test.

- **Talker swing** (`talkerSwing`): for each 3 s window, the loudness of its
  speech (BS.1770's relative gate applied per window, pauses excluded), then
  P95 − P5 over the windows. How far the talking level wanders.
- **True peak**: 4x oversampled.
- **Gain rate**: the AGC's gain, read every 25 ms; its fastest change
  between two readings, either way, in dB/s.
- **Pause lift (breathing)**: how far the chain's total gain climbs during a
  pause over the talk just before it (P95 over every pause).
- **Noise floor**: the quietest 5% of 50 ms windows, above 100 Hz.
- **Hiss**: power in the top of the file's own band (half the cutoff up to
  the cutoff) during the quietest 10% of frames.
- **Hum**: each detected line's level against its neighbours, in the pauses.
- **Voice band**: 300 Hz to 4 kHz over the louder half of the frames.
- **Music bands**: every octave band from 125 Hz to 8 kHz on a music clip.

### Why talker swing

Plain short-term loudness swing has a pause component: between phrases the
level falls by the depth of the pause. Level cannot remove that without
raising the pauses, which is breathing, the thing the brief rules out. So the
swing target is held on the talking level only, and plain swing is reported
beside it.

### Already-level clips

On a clip whose talker swing is already under 3 dB, the 1.3 to 1.5 dB left
after Level is phrasing within one talker (emphasis, the end of a sentence).
No setting removed it without pumping: an eight-setting sweep of the AGC's
time constants, its talker-change threshold and the compressor's ratio
changed no verdict. So the halving applies on clips with at least 3 dB of
talker swing in; under that, Level must not add swing (out at most in).
Jackson, 2026-11-15.

## Targets

| | target |
|---|---|
| Level: talker swing | at most half the original's, on clips with ≥ 3 dB in; otherwise no more than in |
| Level: true peak | ≤ −1 dBTP |
| Level: gain rate | ≤ 30 dB/s either way |
| Level: pumping | gain in a pause ≤ 1 dB over the talk before it (P95) |
| Clean up: floor | down ≥ 8 dB on hissy clips |
| Clean up: hum | each detected line down ≥ 20 dB |
| Clean up: voice | 300 Hz–4 kHz within 1.5 dB of the original |
| Clean up: music | every octave band 125 Hz–8 kHz within 1.5 dB |
| CPU | well inside budget at 4x CPU throttle |

If a target fails, the DSP is fixed. A target is never loosened.

## The test set

`scripts/audio/pick-test-set.ts` picks from the survey, one segment per
episode. Badness is the sum of three z-scores (talker level wandering, a
noise floor close under the programme, hum level):

- the **8 worst**, the **4 typical** (nearest the median badness) and the
  **2 cleanest**;
- the biggest 1 s step (**a hot caller beside a quiet guest**), the most
  **dead air**, the **hummiest** (two or more lines);
- **hiss candidates**, confirmed by hand (below);
- **bumper music**: show openings, cut by hand (the survey's three points
  never land on one).

Each clip is 75 s: 15 s of pre-roll (processed, not scored, so the chain has
settled on the show the way a listener meets it) and the scored minute.

### Heavy hiss is rare, mild hiss is not

The survey's hiss measure (the top of the file's band in its quietest frames)
ranks music beds and continuous talk as "hiss" as readily as tape noise. Its
top candidates were checked by spectrogram and by the pause floor: genuine
hiss is a floor that is present in the pauses, steady (under 3 dB of spread
across them) and flat, up to the file's own cutoff. Many of the archive's
low-bitrate encodes threw the hiss away with the top octave. What remained:

- **heavy:** 1992-12-12 (two minutes of it, the worst tape found), 2001-02-14,
  2000-03-31 (two points);
- **mild, steady:** 1997-07-11, 1998-01-27, 1998-12-01.

The 1992 clips were first set aside as "continuous talk"; the pause floor
and the spectrogram say heavy hiss. All eight are held to the floor target.

## Clean up is held back

Rumble, hum and music protection pass. The hiss gate does not, on the
heaviest tape: an 8 dB floor drop and a voice band within 1.5 dB cannot both
be had there with the gate as it stands.

**Ground truth.** Clean talk (two clips with pauses 41 and 61 dB under the
voice) plus white noise band-limited to the file's cutoff, at a known level.
The gate's per-frame gains are recorded and applied separately to the talk
and to the noise, so speech loss and noise reduction are measured, not
inferred. On it, three faults showed:

1. **The music detector read heavy compressed hiss as music** (score 1.00
   on 1992-12-12) and eased the gate almost off.
2. **The noise estimate was biased.** Minimum statistics read white noise at
   0.52 of its true level, so the correction was 1.9 where it must be 3.6
   (1.5 s window), and over 1.5 s speech leaks into the minimum: 3 to 10 dB
   too high at 300 Hz to 2 kHz, too low in the hiss band.
3. **The gain rule takes speech.** Wiener-type gains cost 2 to 4 dB of real
   speech in 1 to 4 kHz at hiss 6 dB under the voice.

**What was tried** (each on the ground truth and on the five heavy clips):
the bias corrected, windows from 1.5 to 8 s, Wiener, log-spectral amplitude
and OM-LSA gain rules, a floor deeper between words than under them, and
energy given back octave by octave. Every setting lands on the same line:

| setting | floor down (heavy clips) | voice band | verdict |
|---|---|---|---|
| bias corrected, 1.5 s | 7.0 to 10.8 dB | −0.6 to −3.6 dB | 1992 fails voice |
| 8 s window, give-back, floors −18/−10 | 3.3 to 9.3 dB | −0.1 to −1.0 dB | 4 of 5 fail floor |
| 8 s, floors −18/−6, relaxed | 4.9 to 11.5 dB | −0.1 to −1.6 dB | 3 of 5 fail floor |

On 1992-12-12 the hiss itself is 0.2 to 1 dB of the voice band (measured
against an oracle), so a little voice-band drop there is the hiss leaving;
2 to 3.6 dB is the voice.

**Neural options** (Jackson approved downloading them, 2026-11-15; pinned
and hash-checked, offline only so far): DeepFilterNet 0.5.6 with its
attenuation limited to 10 dB takes the floor down 9 to 10 dB on every heavy
clip, and on the ground truth costs 0.7 dB of speech, better than any
classical setting, but on four of the five real clips it takes 4.4 to 8 dB
of the voice band: the 1990s phone-and-tape voice reads to it as noise.
RNNoise's published build refuses to run outside a browser and is being
measured in one. Neither ships until it passes every target in the browser
render test.

## Music

`music.ts` scores 0 (talk) to 1 (music) from how steady the frame power is
over 3 s (talk comes and goes with syllables; a bed or a bumper does not).
Clean up eases the hiss gate toward dry as the score rises, so a bumper
keeps its cymbals. Heavy compressed hiss is steady too, which is fault 1
above: the detector must tell the two apart before Clean up is released.

## Results

Not yet passing. On the 34-clip set (2026-11-16) Level misses the swing
target on 6 clips and the pause target on 1; Clean up misses the floor on 5,
hum on 6 and the music limit on 1. The full table is `before-after.md` in the
Mac's `~/Downloads/high-desert-2026-11-16-audio-cleanup/`. The experimental
onset mode in `leveler.ts` (`LEVEL_AGC.onset`, off) took Level to 2 misses
(swing ratio 0.53 and 0.59) at the cost of 1 s of lookahead.

## CPU

The throttle in Chromium's DevTools reaches the main thread only, not the
audio thread: an offline render took the same time at 1x and 4x. So
`e2e/dsp-render.spec.ts` runs the *built* worklet's processor class on the
throttled main thread, block by block as the audio thread would, and times
`process()` alone: 11.8% of a 4x-throttled core (desktop profile; 10.3%
on the phone profile; worst blocks 7.6 and 9.1 ms) with both switches on,
stereo, 48 kHz. The worst single block is reported, not asserted: the
throttle suspends the thread in slices, and one block can absorb a slice.

## Browsers, and what Playwright cannot show

- **Real Chromium refuses a media source without CORS** once the element has
  `crossOrigin="anonymous"` ("no supported source"), and the player fails over
  to the mirror, which is processed like anything else. archive.org sends
  CORS on every hop. Playwright's `route.fulfill` skips the CORS check, so a
  refused source cannot be staged with `page.route`; `e2e/dsp-player.spec.ts`
  models it as a failed fetch, which takes the same failover.
- **A worklet's `addModule` fetch bypasses `page.route`** in Chromium. The
  "worklet won't load" test patches `AudioWorklet.prototype.addModule`.
- **The silence backstop** stops a show only for a cross-origin source that
  has never made a sound in 20 s of playhead (a source the browser will not
  expose). Real silence never trips it: a source that has spoken once is
  exposed, and a same-origin source (`/mirror`) cannot be refused.

## Counters

`POST /api/stats/dsp` adds one to `dsp_daily` per UTC day and event: a
switch turned on or off (`level-on` ...), a show started with each on
(`play-level`, `play-cleanup`, `play-plain`), the switches unavailable
(`unavailable-ios`, `unavailable-unsupported`) and every fallback to plain
playback (`fallback-load`, `-worklet`, `-stalled`, `-silent`). No session, address or id; `hd-not-counted`
keeps a test browser out.

## Running it

```bash
node scripts/audio/measure-archive.ts docs/audio-processing/archive-survey.csv 150   # the survey (resumable)
node scripts/audio/pick-test-set.ts docs/audio-processing/archive-survey.csv > clips.json
node scripts/audio/evaluate.ts clips.json --out <dir> --json <file>                   # renders and targets
node scripts/audio/build-worklet.mjs                                                   # public/audio/dsp-worklet.js
```
