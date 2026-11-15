import { describe, expect, it } from "vitest";
import type { Clip } from "@/audio/dsp/metrics";
import { measure } from "@/audio/dsp/metrics";
import { render, original } from "@/audio/dsp/render";
import { Chain } from "@/audio/dsp/chain";
import { TARGETS, checkCleanup, humDrop, pauseLift, talkerSwing } from "@/audio/dsp/targets";

/**
 * The Phase 3 targets on synthetic programme, so they are held on every run
 * without the archive (the real clips are scored by scripts/audio/evaluate.ts,
 * docs/audio-processing/README.md). Speech-like: band-limited noise in
 * syllables and phrases with real pauses over a noise floor.
 *
 * Each case names the target it holds; a mutation in scripts/mutate-check.mjs
 * breaks the DSP line that meets it and requires the case to go red.
 */

const FS = 32000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** One-pole filters for shaping noise into a voice-ish band (150 Hz to 3 kHz). */
function shapedNoise(n: number, r: () => number): Float32Array {
  const out = new Float32Array(n);
  const aLp = Math.exp((-2 * Math.PI * 3000) / FS);
  const aHp = Math.exp((-2 * Math.PI * 150) / FS);
  let lp = 0;
  let hpIn = 0;
  let hp = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    lp = (1 - aLp) * w + aLp * lp;
    hp = aHp * (hp + lp - hpIn);
    hpIn = lp;
    out[i] = hp;
  }
  let p = 0;
  for (const v of out) p += v * v;
  const rms = Math.sqrt(p / n);
  for (let i = 0; i < n; i++) out[i] /= rms;
  return out;
}

const db = (d: number) => 10 ** (d / 20);

/**
 * Talk at `levelsDb` (RMS while talking), `segSec` each in turn: phrases of
 * `talkSec` (1.8 s) in 4 Hz syllables, then pause to `phraseSec` (2.3 s). `floorDb` of white noise under everything.
 */
function programme(opts: { levelsDb: number[]; segSec: number; floorDb: number; seed?: number; hum?: { f0: number; db: number }; talkSec?: number; phraseSec?: number }): Clip {
  const r = rng(opts.seed ?? 1);
  const n = Math.round(opts.levelsDb.length * opts.segSec * FS);
  const voice = shapedNoise(n, r);
  const x = new Float32Array(n);
  const phrase = Math.round((opts.phraseSec ?? 2.3) * FS);
  const talk = Math.round((opts.talkSec ?? 1.8) * FS);
  const syl = Math.round(0.25 * FS);
  let sylAmp = 1;
  for (let i = 0; i < n; i++) {
    const seg = Math.min(opts.levelsDb.length - 1, Math.floor(i / (opts.segSec * FS)));
    const inPhrase = i % phrase;
    if (i % syl === 0) sylAmp = 0.55 + 0.45 * r();
    let env = 0;
    if (inPhrase < talk) env = sylAmp * Math.sin((Math.PI * (i % syl)) / syl) ** 2 * 1.6;
    x[i] = voice[i] * env * db(opts.levelsDb[seg]) + (r() * 2 - 1) * db(opts.floorDb) * Math.sqrt(3);
    if (opts.hum) {
      for (let k = 1; k <= 4; k++) x[i] += (db(opts.hum.db) / k) * Math.sin((2 * Math.PI * k * opts.hum.f0 * i) / FS);
    }
  }
  return { fs: FS, ch: [x] };
}

const PRE = 6;

describe("Level", () => {
  // A loud caller and a quiet guest, 12 dB apart, in turn.
  const clip = programme({ levelsDb: [-14, -26, -14, -26, -14, -26], segSec: 8, floorDb: -62 });
  const orig = original(clip, PRE);
  const out = render(clip, { level: true, cleanup: false, preRollSec: PRE });

  it(`cuts the talker swing by at least half (target ${TARGETS.swingRatio})`, () => {
    const inSw = talkerSwing(orig);
    expect(inSw).toBeGreaterThan(8);
    expect(talkerSwing(out) / inSw).toBeLessThanOrEqual(TARGETS.swingRatio);
  });

  it(`never goes over ${TARGETS.truePeakDb} dBTP`, () => {
    expect(measure(out).truePeakDb).toBeLessThanOrEqual(TARGETS.truePeakDb);
  });

  it(`does not breathe: the floor in a pause rises at most ${TARGETS.maxPauseRiseDb} dB`, () => {
    expect(pauseLift(orig, out)).toBeLessThanOrEqual(TARGETS.maxPauseRiseDb);
  });

  it(`does not breathe after a loud last word (at most ${TARGETS.maxPauseRiseDb} dB)`, () => {
    // Every phrase ends on an emphatic word 8 dB up, the case where a
    // compressor recovering in the pause lifts the floor after it.
    const base = programme({ levelsDb: [-20, -20, -20, -20], segSec: 8, floorDb: -55, seed: 11 });
    const x = base.ch[0];
    const phrase = Math.round(2.3 * FS);
    for (let i = 0; i < x.length; i++) {
      const p = i % phrase;
      if (p >= Math.round(1.5 * FS) && p < Math.round(1.8 * FS)) x[i] *= db(8);
    }
    const o = original(base, PRE);
    const y = render(base, { level: true, cleanup: false, preRollSec: PRE });
    expect(pauseLift(o, y)).toBeLessThanOrEqual(TARGETS.maxPauseRiseDb);
  });

  it("lands near -16 LUFS", () => {
    expect(Math.abs(measure(out).lufs - -16)).toBeLessThan(2);
  });
});

describe("both switches off", () => {
  it("is the input, sample for sample, only delayed, and nothing else runs", () => {
    const clip = programme({ levelsDb: [-20], segSec: 4, floorDb: -50, seed: 3 });
    const out = render(clip, { level: false, cleanup: false });
    let maxDiff = 0;
    for (let i = 0; i < out.ch[0].length; i++) maxDiff = Math.max(maxDiff, Math.abs(out.ch[0][i] - clip.ch[0][i]));
    expect(maxDiff).toBe(0);
    // Bypass means bypass: not even Level's meter runs (an old phone's battery).
    const chain = new Chain(FS, { level: false, cleanup: false });
    const b = [new Float32Array(128), new Float32Array(128)];
    for (let i = 0; i + 128 <= clip.ch[0].length; i += 128) {
      b[0].set(clip.ch[0].subarray(i, i + 128));
      b[1].set(clip.ch[0].subarray(i, i + 128));
      chain.process(b, 128);
    }
    expect(chain.idle()).toBe(true);
    expect(chain.level.state().activeLufs).toBe(-Infinity);
  });
});

describe("switching", () => {
  it("turning Level and Clean up on and off mid-programme makes no click", () => {
    // A steady 220 Hz tone: any step in it is a click.
    const n = 6 * FS;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / FS);
    const chain = new Chain(FS, { level: false, cleanup: false });
    const L = [new Float32Array(128), new Float32Array(128)];
    const y = new Float32Array(n);
    for (let i = 0; i < n; i += 128) {
      if (i === 128 * 250) chain.setLevel(true);
      if (i === 128 * 500) chain.setCleanup(true);
      if (i === 128 * 900) chain.setLevel(false);
      if (i === 128 * 1200) chain.setCleanup(false);
      const m = Math.min(128, n - i);
      for (let c = 0; c < 2; c++) L[c].set(x.subarray(i, i + m));
      chain.process(L, m);
      y.set(L[0].subarray(0, m), i);
    }
    // The largest sample-to-sample step of a clean 220 Hz sine at amplitude A
    // is 2*pi*220/FS*A; allow it to be the loudest the chain makes the tone.
    let peak = 0;
    for (let i = chain.latency; i < n; i++) peak = Math.max(peak, Math.abs(y[i]));
    const step = ((2 * Math.PI * 220) / FS) * peak;
    let worst = 0;
    for (let i = chain.latency + 1; i < n; i++) worst = Math.max(worst, Math.abs(y[i] - y[i - 1]));
    expect(worst).toBeLessThanOrEqual(step * 1.15);
  });
});

describe("Clean up", () => {
  it("notches a detected hum line at least 30 dB at its frequency (hum alone, nothing masking the measure)", () => {
    // 4 s of programme to find the hum, then hum alone: the notch's depth, not the meter's floor.
    const talk = programme({ levelsDb: [-20, -20], segSec: 4, floorDb: -70, seed: 9, hum: { f0: 59.7, db: -42 } });
    const n = talk.ch[0].length;
    const x = new Float32Array(n + 4 * FS);
    x.set(talk.ch[0]);
    for (let i = n; i < x.length; i++) for (let k = 1; k <= 4; k++) x[i] += (db(-42) / k) * Math.sin((2 * Math.PI * k * 59.7 * i) / FS);
    const clip = { fs: FS, ch: [x] };
    const tail = 8 + 1;
    const orig = original(clip, tail);
    const out = render(clip, { level: false, cleanup: true, preRollSec: tail });
    const hum = humDrop(orig, out);
    expect(hum.lines.length).toBeGreaterThanOrEqual(3);
    for (const l of hum.lines.filter((l) => l.freq < 200)) expect(l.dropDb).toBeGreaterThanOrEqual(30);
  });

  it(`takes hum down at least ${TARGETS.humDropDb} dB, voice band within ${TARGETS.voiceBandDb} dB`, () => {
    // A hummy recording: the hum 10 dB under the talk. humDrop reads 1 s
    // frames, none of them pure pause, and the voice inside a line's 3 Hz
    // measurement band is rightly kept, so it is the floor of what can be
    // read (with no voice the same notches read 67 to 85 dB). The case
    // above holds the notch's own depth on hum alone.
    const clip = programme({ levelsDb: [-20, -20, -20], segSec: 8, floorDb: -70, seed: 5, hum: { f0: 60, db: -30 } });
    const orig = original(clip, PRE);
    const out = render(clip, { level: false, cleanup: true, preRollSec: PRE });
    const hum = humDrop(orig, out);
    expect(hum.family).toBe(60);
    expect(hum.minDrop).toBeGreaterThanOrEqual(TARGETS.humDropDb);
    const c = checkCleanup(orig, out, { hummy: true });
    expect(Math.abs(c.voiceBandDelta)).toBeLessThanOrEqual(TARGETS.voiceBandDb);
  });

  it(`takes a hiss floor down at least ${TARGETS.floorDropDb} dB, voice band within ${TARGETS.voiceBandDb} dB`, () => {
    const clip = programme({ levelsDb: [-20, -20, -20], segSec: 8, floorDb: -48, seed: 7 });
    const orig = original(clip, PRE);
    const out = render(clip, { level: false, cleanup: true, preRollSec: PRE });
    const c = checkCleanup(orig, out, { hissy: true });
    expect(c.floorDrop).toBeGreaterThanOrEqual(TARGETS.floorDropDb);
    expect(Math.abs(c.voiceBandDelta)).toBeLessThanOrEqual(TARGETS.voiceBandDb);
  });
});
