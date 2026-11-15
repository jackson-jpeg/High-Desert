/**
 * Measurements of a stretch of audio: the archive survey (scripts/audio/
 * measure-archive.ts), the before/after numbers and the Phase 3 pass/fail
 * checks (src/audio/dsp/__tests__/targets.test.ts) all read these, so there is
 * one definition of every number.
 *
 * Loudness follows ITU-R BS.1770-4 / EBU R128 and Tech 3342 (LRA), measured
 * **as played**: a one-channel file is counted as two identical channels,
 * which is how Web Audio's speaker up-mix plays it (L = R = M). ffmpeg's
 * ebur128 counts a mono file as one channel and so reads it 3.01 dB lower.
 */
import { Biquad, highPass, kWeighting } from "./biquad.ts";
import { addPowerSpectrum } from "./fft.ts";
import { truePeakOf } from "./oversample.ts";

export interface Clip {
  fs: number;
  /** One or two channels, equal length. */
  ch: Float32Array[];
}

export const BLOCK_SEC = 0.1;

const lufs = (ms: number) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);
const db = (p: number) => (p > 0 ? 10 * Math.log10(p) : -Infinity);

/** K-weighted channel-summed mean square of each 100 ms block, as played. */
export function kBlocks(c: Clip): Float64Array {
  const blockLen = Math.round(c.fs * BLOCK_SEC);
  const n = Math.floor(c.ch[0].length / blockLen);
  const out = new Float64Array(n);
  const weight = c.ch.length === 1 ? 2 : 1;
  for (const x of c.ch) {
    const [s1, s2] = kWeighting(c.fs).map((k) => new Biquad(k));
    const y = Float64Array.from(x);
    s1.run(y);
    s2.run(y);
    for (let b = 0; b < n; b++) {
      let acc = 0;
      for (let i = b * blockLen, e = i + blockLen; i < e; i++) acc += y[i] * y[i];
      out[b] += (weight * acc) / blockLen;
    }
  }
  return out;
}

/** Mean-square of each sliding window of `w` blocks, hop one block. */
function windows(blocks: Float64Array, w: number): Float64Array {
  const n = blocks.length - w + 1;
  if (n <= 0) return new Float64Array(0);
  const out = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < w; i++) s += blocks[i];
  out[0] = s / w;
  for (let i = 1; i < n; i++) {
    s += blocks[i + w - 1] - blocks[i - 1];
    out[i] = Math.max(0, s) / w;
  }
  return out;
}

/** Short-term (3 s) loudness every 100 ms, LUFS. */
export function shortTermSeries(blocks: Float64Array): Float64Array {
  return windows(blocks, 30).map(lufs);
}

/** Momentary (400 ms) loudness every 100 ms, LUFS. */
export function momentarySeries(blocks: Float64Array): Float64Array {
  return windows(blocks, 4).map(lufs);
}

/** BS.1770-4 integrated loudness: 400 ms blocks, 75 % overlap, gates −70 LUFS and −10 LU. */
export function integrated(blocks: Float64Array): number {
  const m = windows(blocks, 4);
  const abs = Array.from(m).filter((v) => lufs(v) > -70);
  if (!abs.length) return -Infinity;
  const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((v) => lufs(v) > rel);
  return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

/** Short-term values that pass Tech 3342's gates (−70 LUFS, then −20 LU below their power mean). */
export function gatedShortTerm(blocks: Float64Array): number[] {
  const st = windows(blocks, 30);
  const abs = Array.from(st).filter((v) => lufs(v) > -70);
  if (!abs.length) return [];
  const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 20;
  return abs.filter((v) => lufs(v) > rel).map(lufs).sort((a, b) => a - b);
}

/** EBU Tech 3342 loudness range: P95 − P10 of the gated short-term values, LU. */
export function loudnessRange(blocks: Float64Array): number {
  const g = gatedShortTerm(blocks);
  return g.length ? percentile(g, 95) - percentile(g, 10) : 0;
}

/**
 * **The swing**: P95 − P5 of the gated short-term loudness, LU. The quiet
 * guest at one end, the hot caller at the other; Level must at least halve it.
 * Wider than LRA's P10–P95 on purpose, so the extremes count.
 */
export function swing(blocks: Float64Array): number {
  const g = gatedShortTerm(blocks);
  return g.length ? percentile(g, 95) - percentile(g, 5) : 0;
}

/**
 * Where the hiss band starts. 4 kHz on a file that reaches 8 kHz or more;
 * half its cutoff on a narrower one (the catalog has 8 kHz-rate files whose
 * whole band ends near 4 kHz, where a fixed 4 kHz edge measures nothing).
 */
export function hissLow(cutoffHz: number): number {
  return cutoffHz > 0 && cutoffHz < 8000 ? Math.max(1500, cutoffHz / 2) : 4000;
}

/** The mono mix (average of the channels). */
export function monoOf(c: Clip): Float32Array {
  if (c.ch.length === 1) return c.ch[0];
  const [l, r] = c.ch;
  const m = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) m[i] = 0.5 * (l[i] + r[i]);
  return m;
}

export interface Measure {
  seconds: number;
  channels: number;
  /** Integrated loudness as played, LUFS. */
  lufs: number;
  lra: number;
  swing: number;
  /** Largest rise or fall of the short-term loudness within any 1 s, LU (gated values only). */
  maxStep1s: number;
  truePeakDb: number;
  samplePeakDb: number;
  /** Level of the quietest 5 % of 50 ms windows (above 100 Hz, digital silence excluded), dBFS. */
  noiseFloorDb: number;
  /** Median 50 ms level, dBFS: the talking level. */
  medianDb: number;
  /** Share of 50 ms windows under −60 dBFS. */
  deadAir: number;
  /**
   * Power in the top of the file's own band (see hissLow: 4 kHz, or half the
   * cutoff on a narrow file, up to the cutoff, max 12 kHz) during the quietest
   * 10 % of frames, dBFS.
   */
  hissDb: number;
  /** Power in 300 Hz .. 4 kHz over the louder half of the frames, dBFS. */
  voiceBandDb: number;
  /** Where the spectrum falls off the codec's cliff, Hz. */
  cutoffHz: number;
  /** Strongest prominence of a 50 Hz-family line over its neighbours in pauses, dB. */
  hum50: number;
  hum60: number;
  /** Harmonics (of the stronger family, up to the 8th) at least 6 dB proud. */
  humLines: number;
  /** Absolute level of the strongest hum line, dBFS. */
  humLevelDb: number;
  /** Share of samples in flat runs (3+) at the clip level. */
  clipFrac: number;
  /** Side over mid, dB (stereo only; −Infinity for mono). Under −40: dual mono. */
  sideDb: number;
}

/** Everything above, for one clip. */
export function measure(c: Clip): Measure {
  const blocks = kBlocks(c);
  const st = shortTermSeries(blocks);
  const g = gatedShortTerm(blocks);
  const gateLow = g.length ? g[0] : Infinity;
  let maxStep = 0;
  for (let i = 10; i < st.length; i++) {
    if (st[i] < gateLow || st[i - 10] < gateLow) continue;
    maxStep = Math.max(maxStep, Math.abs(st[i] - st[i - 10]));
  }
  const mono = monoOf(c);
  const fs = c.fs;

  // 50 ms windows above 100 Hz: the noise floor and the talking level.
  const hp = Float64Array.from(mono);
  new Biquad(highPass(fs, 100, 0.7071)).run(hp);
  new Biquad(highPass(fs, 100, 0.7071)).run(hp);
  const wl = Math.round(fs * 0.05);
  const levels: number[] = [];
  let dead = 0;
  const nw = Math.floor(hp.length / wl);
  for (let w = 0; w < nw; w++) {
    let s = 0;
    for (let i = w * wl; i < (w + 1) * wl; i++) s += hp[i] * hp[i];
    const L = db(s / wl);
    if (L < -60) dead++;
    if (L >= -100) levels.push(L); // digital silence is not a level
  }
  levels.sort((a, b) => a - b);

  // 2048-point frames: hiss in the quiet ones, voice band in the loud ones, the cutoff.
  const N = 2048;
  const frames: { from: number; e: number }[] = [];
  for (let from = 0; from + N <= mono.length; from += N / 2) {
    let e = 0;
    for (let i = from; i < from + N; i++) e += mono[i] * mono[i];
    if (e / N > 1e-10) frames.push({ from, e });
  }
  const byE = [...frames].sort((a, b) => a.e - b.e);
  const quiet = byE.slice(0, Math.max(1, Math.floor(byE.length * 0.1)));
  const loud = byE.slice(Math.floor(byE.length * 0.5));
  const avg = (fr: { from: number }[]) => {
    const acc = new Float64Array(N / 2 + 1);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (const f of fr) addPowerSpectrum(mono, f.from, N, acc, re, im);
    for (let k = 0; k < acc.length; k++) acc[k] /= Math.max(1, fr.length);
    return acc;
  };
  const binHz = fs / N;
  const band = (spec: Float64Array, lo: number, hi: number) => {
    let s = 0;
    for (let k = Math.ceil(lo / binHz); k <= Math.min(spec.length - 1, Math.floor(hi / binHz)); k++) s += spec[k];
    // Hann's equivalent noise bandwidth is 1.5 bins: a band's power sum counts each bin's share once.
    return db(s / 1.5);
  };
  const loudSpec = frames.length ? avg(loud) : new Float64Array(N / 2 + 1);
  const quietSpec = frames.length ? avg(quiet) : new Float64Array(N / 2 + 1);
  const smooth = (spec: Float64Array, k: number) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(1, k - 4); j <= Math.min(spec.length - 1, k + 4); j++) {
      s += spec[j];
      n++;
    }
    return db(s / n);
  };
  let ref = 0;
  {
    let s = 0;
    let n = 0;
    for (let k = Math.ceil(1000 / binHz); k <= Math.floor(3000 / binHz); k++) {
      s += loudSpec[k];
      n++;
    }
    ref = db(s / n);
  }
  let cutoffHz = 0;
  for (let k = loudSpec.length - 1; k > 0; k--) {
    if (smooth(loudSpec, k) > ref - 45) {
      cutoffHz = k * binHz;
      break;
    }
  }

  const hum = humLines(mono, fs);

  // Clipping: flat runs at the top of the range.
  let clipped = 0;
  let total = 0;
  let peak = 0;
  for (const x of c.ch) {
    let m = 0;
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
    peak = Math.max(peak, m);
    total += x.length;
    if (m < 0.9) continue;
    const t = 0.98 * m;
    let run = 0;
    for (let i = 0; i <= x.length; i++) {
      if (i < x.length && Math.abs(x[i]) >= t) run++;
      else {
        if (run >= 3) clipped += run;
        run = 0;
      }
    }
  }

  let sideDb = -Infinity;
  if (c.ch.length === 2) {
    const [l, r] = c.ch;
    let ss = 0;
    let mm = 0;
    for (let i = 0; i < l.length; i++) {
      ss += (l[i] - r[i]) ** 2;
      mm += (l[i] + r[i]) ** 2;
    }
    sideDb = mm > 0 ? db(ss / mm) : -Infinity;
  }

  return {
    seconds: c.ch[0].length / fs,
    channels: c.ch.length,
    lufs: integrated(blocks),
    lra: loudnessRange(blocks),
    swing: g.length ? percentile(g, 95) - percentile(g, 5) : 0,
    maxStep1s: maxStep,
    truePeakDb: Math.max(...c.ch.map((x) => truePeakOf(x))),
    samplePeakDb: 20 * Math.log10(peak || 1e-12),
    noiseFloorDb: levels.length ? percentile(levels, 5) : -Infinity,
    medianDb: levels.length ? percentile(levels, 50) : -Infinity,
    deadAir: nw ? dead / nw : 0,
    hissDb: band(quietSpec, hissLow(cutoffHz), Math.min(12000, cutoffHz || 12000)),
    voiceBandDb: band(loudSpec, 300, 4000),
    cutoffHz,
    hum50: hum.prom50,
    hum60: hum.prom60,
    humLines: hum.lines,
    humLevelDb: hum.levelDb,
    clipFrac: total ? clipped / total : 0,
    sideDb,
  };
}

export interface HumReport {
  prom50: number;
  prom60: number;
  /** The family with the stronger line. */
  family: 50 | 60;
  lines: number;
  levelDb: number;
  /** Prominence of each harmonic 1..8 of the stronger family, dB. */
  perHarmonic: number[];
}

/**
 * Mains hum, measured where it shows: the long-term spectrum (1.46 Hz bins at
 * 48 kHz) of the quietest 30 % of 0.68 s frames. A line's prominence is its
 * peak power within ±1.5 Hz over the median of the bins 4..15 Hz either side.
 */
export function humLines(mono: Float32Array, fs: number): HumReport {
  const N = fs > 30000 ? 32768 : 16384;
  const frames: { from: number; e: number }[] = [];
  for (let from = 0; from + N <= mono.length; from += N / 2) {
    let e = 0;
    for (let i = from; i < from + N; i++) e += mono[i] * mono[i];
    if (e > 0) frames.push({ from, e });
  }
  const pick = [...frames].sort((a, b) => a.e - b.e).slice(0, Math.max(1, Math.ceil(frames.length * 0.3)));
  const acc = new Float64Array(N / 2 + 1);
  if (frames.length) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (const f of pick) addPowerSpectrum(mono, f.from, N, acc, re, im);
    for (let k = 0; k < acc.length; k++) acc[k] /= pick.length;
  }
  const binHz = fs / N;
  const line = (f: number) => {
    let peak = 0;
    for (let k = Math.round((f - 1.5) / binHz); k <= Math.round((f + 1.5) / binHz); k++) peak = Math.max(peak, acc[k] ?? 0);
    const around: number[] = [];
    for (let k = Math.round((f - 15) / binHz); k <= Math.round((f - 4) / binHz); k++) around.push(acc[k] ?? 0);
    for (let k = Math.round((f + 4) / binHz); k <= Math.round((f + 15) / binHz); k++) around.push(acc[k] ?? 0);
    around.sort((a, b) => a - b);
    const med = around[around.length >> 1] || 1e-30;
    return { prom: peak > 0 ? 10 * Math.log10(peak / med) : 0, levelDb: db(peak) };
  };
  const fam = (f0: number) => Array.from({ length: 8 }, (_, i) => line(f0 * (i + 1)));
  const h50 = fam(50);
  const h60 = fam(60);
  const max = (h: { prom: number }[]) => Math.max(...h.map((x) => x.prom));
  const p50 = max(h50);
  const p60 = max(h60);
  const best = p60 >= p50 ? h60 : h50;
  const strongest = best.reduce((a, b) => (b.prom > a.prom ? b : a));
  return {
    prom50: p50,
    prom60: p60,
    family: p60 >= p50 ? 60 : 50,
    lines: best.filter((x) => x.prom >= 6).length,
    levelDb: strongest.levelDb,
    perHarmonic: best.map((x) => x.prom),
  };
}
