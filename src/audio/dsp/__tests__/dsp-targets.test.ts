import { describe, expect, it } from "vitest";
import type { Clip } from "@/audio/dsp/metrics";
import { measure } from "@/audio/dsp/metrics";
import { render, original } from "@/audio/dsp/render";
import { Chain } from "@/audio/dsp/chain";
import { TARGETS, checkCleanup, checkLevel, humDrop, pauseLift, talkerSwing, type GainPoint } from "@/audio/dsp/targets";
import { envelopeForClip } from "@/audio/dsp/envelope-offline";

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

describe("talker swing is measured on talk only", () => {
  it("a talker who pauses more in one stretch is not a quieter talker", () => {
    // One talker at one level: 24 s of dense talk, then 24 s with long pauses.
    const dense = programme({ levelsDb: [-20, -20, -20], segSec: 8, floorDb: -62 });
    const sparse = programme({ levelsDb: [-20, -20, -20], segSec: 8, floorDb: -62, talkSec: 0.9, phraseSec: 3.2, seed: 2 });
    const both: Clip = { fs: FS, ch: [Float32Array.from([...dense.ch[0], ...sparse.ch[0]])] };
    expect(talkerSwing(both)).toBeLessThan(2);
  });

  it("long pauses add no swing: a pause is not a quiet talker", () => {
    const levelsDb = [-20, -20, -20, -20, -20, -20];
    const dense = talkerSwing(programme({ levelsDb, segSec: 8, floorDb: -62 }));
    const sparse = talkerSwing(programme({ levelsDb, segSec: 8, floorDb: -62, talkSec: 0.9, phraseSec: 3.2 }));
    // A few tenths either way from syllable chance; counted with the pauses it is several dB.
    expect(Math.abs(sparse - dense)).toBeLessThan(1.5);
  });

  it("a 12 dB talker change is all there", () => {
    const c = programme({ levelsDb: [-14, -26, -14, -26], segSec: 8, floorDb: -62 });
    expect(talkerSwing(c)).toBeGreaterThan(9);
  });
});

describe("Level, two-pass (the envelope)", () => {
  // A loud caller and a quiet guest, 12 dB apart, in turn.
  const clip = programme({ levelsDb: [-14, -26, -14, -26, -14, -26], segSec: 8, floorDb: -62 });
  const orig = original(clip, PRE);
  const envelope = envelopeForClip(clip);
  const trace: GainPoint[] = [];
  const out = render(clip, {
    level: true,
    cleanup: false,
    preRollSec: PRE,
    envelope,
    onStatus: (t, st) => {
      if (t >= PRE) trace.push({ t: t - PRE, gainDb: st.level.gainDb, frozen: st.level.frozen });
    },
  });
  const check = checkLevel(orig, out, trace);

  it(`cuts the talker swing by at least half (target ${TARGETS.swingRatio})`, () => {
    expect(check.swingIn).toBeGreaterThan(8);
    expect(check.swingRatio).toBeLessThanOrEqual(TARGETS.swingRatio);
  });

  it(`never goes over ${TARGETS.truePeakDb} dBTP, and moves no faster than ${TARGETS.maxGainRate} dB/s`, () => {
    expect(check.pass.peak).toBe(true);
    expect(check.maxRiseRate).toBeGreaterThan(1); // the trace really is the envelope
    expect(check.pass.rate).toBe(true);
  });

  it(`does not breathe: the floor in a pause rises at most ${TARGETS.maxPauseRiseDb} dB`, () => {
    expect(check.maxPauseRise).toBeLessThanOrEqual(TARGETS.maxPauseRiseDb);
  });

  it("lands near -18 LUFS", () => {
    expect(Math.abs(measure(out).lufs - -18)).toBeLessThan(2);
  });

  it("with an envelope the live AGC and compressor step aside: a 0 dB envelope leaves the level alone", () => {
    const quiet = programme({ levelsDb: [-30, -30, -30], segSec: 6, floorDb: -70, seed: 5 });
    const flat = { ...envelope, gainDb: new Float32Array(envelope.gainDb.length) };
    const y = render(quiet, { level: true, cleanup: false, preRollSec: 2, envelope: flat });
    expect(Math.abs(measure(y).lufs - measure(original(quiet, 2)).lufs)).toBeLessThan(0.5);
  });
});

describe("Level, the live leveler (fallback while a show has no envelope)", () => {
  // A loud caller and a quiet guest, 12 dB apart, in turn.
  const clip = programme({ levelsDb: [-14, -26, -14, -26, -14, -26], segSec: 8, floorDb: -62 });
  const orig = original(clip, PRE);
  const out = render(clip, { level: true, cleanup: false, preRollSec: PRE });

  it(`cuts the talker swing by at least half (target ${TARGETS.swingRatio})`, () => {
    const inSw = talkerSwing(orig);
    expect(inSw).toBeGreaterThan(8);
    expect(talkerSwing(out, orig) / inSw).toBeLessThanOrEqual(TARGETS.swingRatio);
  });

  it(`never goes over ${TARGETS.truePeakDb} dBTP`, () => {
    expect(measure(out).truePeakDb).toBeLessThanOrEqual(TARGETS.truePeakDb);
  });

  it(`adds no swing to a clip already level (under ${TARGETS.swingAppliesFromDb} dB in), and the check says which rule it used`, () => {
    // One talker throughout, with phrase-to-phrase emphasis only.
    const level = programme({ levelsDb: [-20, -21, -19.5, -20.5, -20, -19], segSec: 8, floorDb: -62 });
    const o = original(level, PRE);
    const l = render(level, { level: true, cleanup: false, preRollSec: PRE });
    const inSw = talkerSwing(o);
    expect(inSw).toBeLessThan(TARGETS.swingAppliesFromDb);
    expect(talkerSwing(l, o)).toBeLessThanOrEqual(inSw);
    expect(checkLevel(o, l, []).pass.swing).toBe(true);
    // Not a free pass: an output with more swing than the level input fails.
    expect(checkLevel(o, orig, []).pass.swing).toBe(false);
    // And above the line the halving is the rule: the 12 dB clip, unprocessed, fails.
    expect(checkLevel(orig, orig, []).pass.swing).toBe(false);
  }, 30_000); // a 48 s render inside the test; under heavy's nice 15 it can pass 5 s

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

  it("stereo: one linked gate cleans both channels, and going stereo mid-stream leaves no seam", () => {
    // Identical channels for 4 s (mono to the gate), then the right channel
    // gets its own hiss: the gate goes stereo there.
    const a = programme({ levelsDb: [-20, -20, -20], segSec: 6, floorDb: -48, seed: 7 }).ch[0];
    const r0 = rng(99);
    const b = Float32Array.from(a, (v, i) => (i < 4 * FS ? v : v + (r0() * 2 - 1) * db(-50) * Math.sqrt(3)));
    const clip: Clip = { fs: FS, ch: [a, b] };
    const orig = original(clip, PRE);
    const out = render(clip, { level: false, cleanup: true, preRollSec: PRE });
    for (const c of [0, 1]) {
      const o1 = { fs: FS, ch: [orig.ch[c]] };
      const y1 = { fs: FS, ch: [out.ch[c]] };
      const k = checkCleanup(o1, y1, { hissy: true });
      expect(k.floorDrop).toBeGreaterThanOrEqual(TARGETS.floorDropDb);
      expect(Math.abs(k.voiceBandDelta)).toBeLessThanOrEqual(TARGETS.voiceBandDb);
    }
    // Around the switch (at 4 s of input) the right channel carries on: no
    // sample-to-sample step bigger than the programme makes anywhere else.
    const full = render(clip, { level: false, cleanup: true });
    const y = full.ch[1];
    const steps = (from: number, to: number) => {
      let m = 0;
      for (let i = from + 1; i < to; i++) m = Math.max(m, Math.abs(y[i] - y[i - 1]));
      return m;
    };
    const atSwitch = steps(4 * FS - 2048, 4 * FS + 2048);
    const elsewhere = steps(FS, 4 * FS - 4096);
    expect(atSwitch).toBeLessThanOrEqual(elsewhere * 1.5);
  });
});
