/**
 * The DSP's math against known answers: the standard's own numbers where it
 * gives them, and physics where it does not. Offline, in Node, no browser.
 */
import { describe, expect, it } from "vitest";
import { Biquad, highPass, kWeighting, magnitudeDb } from "../biquad.ts";
import { Compressor } from "../compressor.ts";
import { Denoiser, N as DN_N } from "../denoise.ts";
import { fft, ifft } from "../fft.ts";
import { Limiter } from "../limiter.ts";
import { integrated, kBlocks, loudnessRange, measure } from "../metrics.ts";
import { TruePeakDetector, truePeakOf } from "../oversample.ts";

const FS = 48000;
function sine(freq: number, dbfs: number, sec: number, phase = 0, fs = FS): Float32Array {
  const a = Math.pow(10, dbfs / 20);
  return Float32Array.from({ length: Math.round(sec * fs) }, (_, i) => a * Math.sin((2 * Math.PI * freq * i) / fs + phase));
}
/** A seeded uniform generator, so noise tests are repeatable. */
function rng(seed = 1): () => number {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
function noise(dbfsRms: number, len: number, seed = 1): Float32Array {
  const r = rng(seed);
  const a = Math.pow(10, dbfsRms / 20) * Math.sqrt(3); // uniform [-a, a] has rms a/sqrt(3)
  return Float32Array.from({ length: len }, () => a * (2 * r() - 1));
}
const rmsDb = (x: ArrayLike<number>, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / (to - from));
};

describe("K-weighting", () => {
  it("reproduces BS.1770-4's 48 kHz coefficients", () => {
    const [shelf, hp] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 10);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 10);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 10);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 10);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 10);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 10);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 10);
  });

  it("has the same response at 44.1 kHz (derived, not tabled)", () => {
    for (const f of [100, 1000, 4000, 10000]) {
      const g48 = kWeighting(48000).reduce((s, c) => s + magnitudeDb(c, 48000, f), 0);
      const g44 = kWeighting(44100).reduce((s, c) => s + magnitudeDb(c, 44100, f), 0);
      expect(Math.abs(g48 - g44)).toBeLessThan(0.05);
    }
  });
});

describe("loudness", () => {
  it("reads a 1 kHz tone at -23 dBFS on both channels as -23 LUFS (EBU Tech 3341)", () => {
    const x = sine(1000, -23, 20);
    expect(integrated(kBlocks({ fs: FS, ch: [x, x] }))).toBeCloseTo(-23, 1);
  });

  it("counts a mono file as played: the same as two identical channels", () => {
    const x = sine(1000, -23, 20);
    expect(integrated(kBlocks({ fs: FS, ch: [x] }))).toBeCloseTo(-23, 1);
  });

  it("gives LRA 10 LU for Tech 3342's case 1 (20 s at -20, then 20 s at -30)", () => {
    const x = new Float32Array(FS * 40);
    x.set(sine(1000, -20, 20), 0);
    x.set(sine(1000, -30, 20), FS * 20);
    expect(loudnessRange(kBlocks({ fs: FS, ch: [x, x] }))).toBeCloseTo(10, 0);
  });
});

describe("true peak", () => {
  it("sees the peak between samples (a quarter-rate sine sampled at 45 degrees)", () => {
    const x = sine(FS / 4, 0, 1, Math.PI / 4);
    // Every sample is ±0.707 (-3 dBFS); the waveform reaches 1.0 (0 dBTP).
    let sp = 0;
    for (const v of x) sp = Math.max(sp, Math.abs(v));
    expect(20 * Math.log10(sp)).toBeCloseTo(-3.01, 1);
    expect(truePeakOf(x)).toBeGreaterThan(-0.6);
  });
});

describe("FFT", () => {
  it("round-trips", () => {
    const r = rng(7);
    const re = Float64Array.from({ length: 1024 }, () => r() - 0.5);
    const im = new Float64Array(1024);
    const keep = re.slice();
    fft(re, im);
    ifft(re, im);
    for (let i = 0; i < 1024; i++) expect(re[i]).toBeCloseTo(keep[i], 9);
  });
});

describe("biquad", () => {
  it("a 70 Hz 4th-order Butterworth high-pass: -3 dB at 70, under -20 dB at 35, flat at 300", () => {
    const s1 = highPass(FS, 70, 0.5412);
    const s2 = highPass(FS, 70, 1.3066);
    const at = (f: number) => magnitudeDb(s1, FS, f) + magnitudeDb(s2, FS, f);
    expect(at(70)).toBeCloseTo(-3, 0);
    expect(at(35)).toBeLessThan(-20);
    expect(Math.abs(at(300))).toBeLessThan(0.1);
  });
});

describe("limiter", () => {
  it("holds a hot, jumpy signal under -1 dBTP and leaves quiet audio alone", () => {
    const lim = new Limiter({ fs: FS, channels: 2, ceilingDb: -1.3, lookaheadMs: 5, releaseMs: 80 });
    const len = FS * 4;
    const l = new Float32Array(len);
    const r = new Float32Array(len);
    const n = noise(-30, len, 3);
    for (let i = 0; i < len; i++) {
      // A quiet bed with 20 ms bursts 30 dB hotter every half second.
      const burst = i % (FS / 2) < FS * 0.02 ? 50 : 1;
      l[i] = n[i] * burst;
      r[i] = -n[i] * burst;
    }
    const keep = l.slice();
    for (let i = 0; i < len; i += 128) lim.process([l.subarray(i, i + 128), r.subarray(i, i + 128)], Math.min(128, len - i));
    expect(truePeakOf(l)).toBeLessThanOrEqual(-1.0);
    expect(truePeakOf(r)).toBeLessThanOrEqual(-1.0);
    // Between the bursts, once released (five 80 ms time constants after a
    // burst at 0..20 ms), the bed comes out as it went in.
    const d = lim.latency;
    const from = Math.round(FS * 0.43);
    const to = FS / 2 - 1000;
    expect(Math.abs(rmsDb(l, from + d, to + d) - rmsDb(keep, from, to))).toBeLessThan(0.1);
  });
});

describe("limiter, between the samples", () => {
  it("catches a peak no sample shows (a quarter-rate sine at 45 degrees: samples -3 dBFS, true peak 0 dBTP)", () => {
    const lim = new Limiter({ fs: FS, channels: 2, ceilingDb: -1.3, lookaheadMs: 5, releaseMs: 80 });
    const len = FS;
    const l = new Float32Array(len);
    for (let i = 0; i < len; i++) l[i] = Math.sin((Math.PI / 2) * i + Math.PI / 4);
    const r = l.slice();
    expect(Math.max(...l)).toBeLessThan(0.71); // every sample is under the ceiling
    expect(truePeakOf(l)).toBeGreaterThan(-0.5); // the waveform is not
    for (let i = 0; i < len; i += 128) lim.process([l.subarray(i, i + 128), r.subarray(i, i + 128)], Math.min(128, len - i));
    // Measured inside the signal: truePeakOf pads the end with zeros, and a
    // full-scale sine stopped dead rings in the reconstruction (that edge is
    // the meter's, not the limiter's).
    const d = new TruePeakDetector();
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const t = d.tick(l[i]);
      if (i > FS / 10 && t > peak) peak = t;
    }
    expect(20 * Math.log10(peak)).toBeLessThanOrEqual(-1.0);
  });
});

describe("compressor", () => {
  it("follows its static curve: nothing under the knee, 2:1 well above", () => {
    expect(Compressor.curve(-30, -14, 2, 8)).toBe(0);
    expect(Compressor.curve(-2, -14, 2, 8)).toBeCloseTo(6, 6);
    expect(Compressor.curve(-14, -14, 2, 8)).toBeGreaterThan(0);
  });
});

describe("spectral gate", () => {
  it("has a latency of exactly N samples", () => {
    const d = new Denoiser({ fs: FS, floorDb: -12, lowFloorDb: -5 });
    // A loud tone (well over any noise estimate), then an impulse riding on it, is passed through.
    const x = sine(1000, -10, 1);
    x[20000] += 0.5;
    const y = x.slice();
    for (let i = 0; i < y.length; i += 128) d.process(y.subarray(i, i + 128), 128);
    let bestLag = 0;
    let best = -Infinity;
    for (let lag = DN_N - 8; lag <= DN_N + 8; lag++) {
      let s = 0;
      for (let i = 10000; i < 40000; i++) s += x[i] * (y[i + lag] ?? 0);
      if (s > best) {
        best = s;
        bestLag = lag;
      }
    }
    expect(bestLag).toBe(DN_N);
  });

  it("cuts steady hiss by at least 8 dB and leaves a loud tone within 0.5 dB", () => {
    const d = new Denoiser({ fs: FS, floorDb: -12, lowFloorDb: -5 });
    const len = FS * 8;
    const hiss = noise(-50, len, 11);
    const tone = sine(700, -14, 8);
    const x = new Float32Array(len);
    // Tone on for 1 s, off for 1 s: the gaps are hiss alone.
    for (let i = 0; i < len; i++) x[i] = hiss[i] + (Math.floor(i / FS) % 2 === 0 ? tone[i] : 0);
    const y = x.slice();
    for (let i = 0; i < len; i += 128) d.process(y.subarray(i, i + 128), 128);
    const gap = (s: number) => [s * FS + 4000, (s + 1) * FS - 4000] as const;
    const [g0, g1] = gap(5);
    expect(rmsDb(y, g0 + DN_N, g1 + DN_N) - rmsDb(x, g0, g1)).toBeLessThan(-8);
    const [t0, t1] = gap(6);
    expect(Math.abs(rmsDb(y, t0 + DN_N, t1 + DN_N) - rmsDb(x, t0, t1))).toBeLessThan(0.5);
  });
});

describe("measure()", () => {
  it("finds a 60 Hz hum line and not a 50 Hz one", () => {
    const len = FS * 20;
    const n = noise(-45, len, 5);
    const h = sine(60.2, -40, 20);
    const h3 = sine(180.6, -46, 20);
    const x = Float32Array.from({ length: len }, (_, i) => n[i] + h[i] + h3[i]);
    const m = measure({ fs: FS, ch: [x] });
    expect(m.hum60).toBeGreaterThan(20);
    expect(m.hum50).toBeLessThan(6);
    expect(m.humLines).toBeGreaterThanOrEqual(2);
  });
});

describe("Biquad.run", () => {
  it("is the same as tick, sample for sample", () => {
    const c = highPass(FS, 100, 0.7);
    const a = new Biquad(c);
    const b = new Biquad(c);
    const x = noise(-10, 1000, 9);
    const y = Float64Array.from(x);
    b.run(y);
    for (let i = 0; i < x.length; i++) expect(a.tick(x[i])).toBeCloseTo(y[i], 12);
  });
});
