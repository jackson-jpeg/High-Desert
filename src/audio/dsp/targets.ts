/**
 * The pass/fail targets (docs/audio-processing/README.md, "Targets"), as
 * functions of an original clip and its render. The offline tests, the
 * before/after table and the browser render test all call these, so a
 * target means one thing everywhere. If one fails, fix the DSP: never the
 * number here.
 */
import { type Clip, kBlocks, measure, monoOf } from "./metrics.ts";
import { addPowerSpectrum, fft } from "./fft.ts";

export const TARGETS = {
  /**
   * Level: the talker swing (talkerSwing(): P95 - P5 of each 3 s window's
   * loudness over its speech, pauses excluded) at most half the original's.
   * Plain short-term swing is reported beside it: its pause component cannot
   * be reduced without raising the pauses, which is breathing
   * (docs/audio-processing/README.md, "Why talker swing").
   */
  swingRatio: 0.5,
  /**
   * ...on a clip whose talker swing is at least this (dB). Under it the clip
   * is already level: the 1.3 to 1.5 dB left is phrasing within one talker,
   * which no setting removed without pumping (README, "Already-level clips").
   * There Level must not add swing: out at most in. Jackson, 2026-11-15.
   */
  swingAppliesFromDb: 3,
  /** Level: nothing above -1 dBTP. */
  truePeakDb: -1,
  /** Level: gain never moves faster than this, either way (dB/s). */
  maxGainRate: 30,
  /**
   * Level: no breathing. The total gain the chain applies in a pause may not
   * sit more than this above the gain on the talk just before it (P95 over
   * every pause block, so one misjudged block is not the verdict).
   */
  maxPauseRiseDb: 1,
  /** Clean up: the noise floor down at least this on hissy clips. */
  floorDropDb: 8,
  /** Clean up: detected hum lines down at least this. */
  humDropDb: 20,
  /** Clean up: 300 Hz - 4 kHz energy within this of the original. */
  voiceBandDb: 1.5,
  /** Clean up: on music, every octave band 125 Hz - 8 kHz within this of the original. */
  musicBandDb: 1.5,
} as const;

const lufsOf = (ms: number) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);

/**
 * Talker swing: for each 3 s window (hop 100 ms), the loudness of its 100 ms
 * blocks within 10 LU of the clip's gated loudness (BS.1770's own relative
 * gate, applied per window), when at least half the window is speech; then
 * P95 - P5 over the windows. How far the talking level wanders, which is
 * what Level is for, without the pauses between phrases.
 */
export function talkerSwing(c: Clip): number {
  const b = kBlocks(c);
  const abs = Array.from(b).filter((v) => lufsOf(v) > -70);
  if (!abs.length) return 0;
  const rel = lufsOf(abs.reduce((a, x) => a + x, 0) / abs.length) - 10;
  const vals: number[] = [];
  for (let i = 0; i + 30 <= b.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = i; j < i + 30; j++) {
      if (lufsOf(b[j]) > rel) {
        s += b[j];
        n++;
      }
    }
    if (n >= 15) vals.push(lufsOf(s / n));
  }
  if (vals.length < 2) return 0;
  vals.sort((x, y) => x - y);
  return vals[Math.round(0.95 * (vals.length - 1))] - vals[Math.round(0.05 * (vals.length - 1))];
}

/**
 * Breathing: how far the chain's total gain climbs *during* a pause. Blocks
 * are 50 ms; a pause is a run of at least MIN_PAUSE_BLOCKS (200 ms) more
 * than 20 dB under the local talking level (the 80th-percentile block within
 * 3 s either side: with a loud host and a quiet caller, the host's level
 * would make the caller's soft syllables "pauses").
 * Shorter dips are the gaps between syllables, where speech masks the floor
 * on both sides; breathing is the floor heard rising in a real gap. Each run is measured against
 * the median gain over the talk in the 0.5 s before it began, so an AGC
 * rising through a quiet caller's talk (which it should) is not charged to
 * the pause after it. `out` must be a gain-only render (Level alone),
 * aligned with `orig`. Returns P95 over every pause block, dB (0 if none).
 */
const MIN_PAUSE_BLOCKS = 4;

export function pauseLift(orig: Clip, out: Clip): number {
  const fs = orig.fs;
  const B = Math.round(0.05 * fs);
  const xi = monoOf(orig);
  const xo = monoOf(out);
  const n = Math.floor(Math.min(xi.length, xo.length) / B);
  const li = new Float64Array(n);
  const g = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let a = 0;
    let o = 0;
    for (let i = k * B; i < (k + 1) * B; i++) {
      a += xi[i] * xi[i];
      o += xo[i] * xo[i];
    }
    li[k] = 10 * Math.log10(a / B + 1e-20);
    g[k] = a > 0 ? 10 * Math.log10((o + 1e-20) / a) : NaN;
  }
  const W = Math.round(3 / 0.05);
  const talk = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const win: number[] = [];
    for (let j = Math.max(0, k - W); j <= Math.min(n - 1, k + W); j++) if (li[j] > -100) win.push(li[j]);
    win.sort((x, y) => x - y);
    talk[k] = win.length ? win[Math.round(0.8 * (win.length - 1))] : -Infinity;
  }
  const isPause = (k: number) => li[k] < talk[k] - 20 && li[k] > -100 && Number.isFinite(g[k]);
  const lifts: number[] = [];
  const before = Math.round(0.5 / 0.05);
  for (let k = 0; k < n; ) {
    if (!isPause(k)) {
      k++;
      continue;
    }
    const ref: number[] = [];
    for (let j = Math.max(0, k - before); j < k; j++) if (li[j] > talk[j] - 10 && Number.isFinite(g[j])) ref.push(g[j]);
    let e = k;
    while (e < n && isPause(e)) e++;
    if (ref.length >= 3 && e - k >= MIN_PAUSE_BLOCKS) {
      ref.sort((x, y) => x - y);
      const r = ref[ref.length >> 1];
      for (let j = k; j < e; j++) lifts.push(g[j] - r);
    }
    k = e;
  }
  if (!lifts.length) return 0;
  lifts.sort((x, y) => x - y);
  return lifts[Math.round(0.95 * (lifts.length - 1))];
}

export interface GainPoint {
  t: number;
  gainDb: number;
  frozen: boolean;
}

export interface LevelCheck {
  swingIn: number;
  swingOut: number;
  swingRatio: number;
  stSwingIn: number;
  stSwingOut: number;
  truePeakIn: number;
  truePeakOut: number;
  lufsIn: number;
  lufsOut: number;
  maxRiseRate: number;
  maxFallRate: number;
  maxPauseRise: number;
  pass: { swing: boolean; peak: boolean; rate: boolean; pause: boolean };
}

/** `trace` is the AGC's gain every 25 ms (from render's onStatus). */
export function checkLevel(orig: Clip, out: Clip, trace: GainPoint[]): LevelCheck {
  const mi = measure(orig);
  const mo = measure(out);
  let rise = 0;
  let fall = 0;
  for (let i = 1; i < trace.length; i++) {
    const dt = trace[i].t - trace[i - 1].t;
    if (dt <= 0) continue;
    const r = (trace[i].gainDb - trace[i - 1].gainDb) / dt;
    if (r > rise) rise = r;
    if (-r > fall) fall = -r;
  }
  const tIn = talkerSwing(orig);
  const tOut = talkerSwing(out);
  const swingRatio = tIn > 0 ? tOut / tIn : 0;
  const pauseRise = pauseLift(orig, out);
  return {
    swingIn: tIn,
    swingOut: tOut,
    swingRatio,
    stSwingIn: mi.swing,
    stSwingOut: mo.swing,
    truePeakIn: mi.truePeakDb,
    truePeakOut: mo.truePeakDb,
    lufsIn: mi.lufs,
    lufsOut: mo.lufs,
    maxRiseRate: rise,
    maxFallRate: fall,
    maxPauseRise: pauseRise,
    pass: {
      swing: tIn >= TARGETS.swingAppliesFromDb ? swingRatio <= TARGETS.swingRatio : tOut <= tIn,
      peak: mo.truePeakDb <= TARGETS.truePeakDb,
      rate: rise <= TARGETS.maxGainRate && fall <= TARGETS.maxGainRate,
      pause: pauseRise <= TARGETS.maxPauseRiseDb,
    },
  };
}

/**
 * The spectrum of a whole clip in one FFT (60 s gives 0.015 Hz bins, so a
 * steady mains line stands far above the noise in its bin and is measured
 * itself, not what surrounds it). Hann-windowed; power per bin.
 */
export function longSpectrum(x: Float32Array, fs: number): { power: Float64Array; binHz: number } {
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / x.length));
  fft(re, im);
  const power = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  return { power, binHz: fs / n };
}

/** The strongest bin within ±halfWidth Hz of `f`: [frequency, dB]. */
export function lineAt(s: { power: Float64Array; binHz: number }, f: number, halfWidth = 0.15): [number, number] {
  let best = 0;
  let bk = Math.round(f / s.binHz);
  for (let k = Math.max(0, Math.round((f - halfWidth) / s.binHz)); k <= Math.min(s.power.length - 1, Math.round((f + halfWidth) / s.binHz)); k++) {
    if (s.power[k] > best) {
      best = s.power[k];
      bk = k;
    }
  }
  return [bk * s.binHz, 10 * Math.log10(best + 1e-30)];
}

/** Octave-band levels (power per band, dB) over the whole clip. */
export function octaveBands(x: Float32Array, fs: number): number[] {
  const N = 4096;
  const acc = new Float64Array(N / 2 + 1);
  let frames = 0;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let s = 0; s + N <= x.length; s += N / 2) {
    addPowerSpectrum(x, s, N, acc, re, im);
    frames++;
  }
  const binHz = fs / N;
  return [125, 250, 500, 1000, 2000, 4000, 8000].map((fc) => {
    let p = 0;
    for (let k = Math.ceil((fc / Math.SQRT2) / binHz); k <= Math.min(acc.length - 1, Math.floor((fc * Math.SQRT2) / binHz)); k++) p += acc[k];
    return 10 * Math.log10(p / Math.max(1, frames) + 1e-30);
  });
}

/**
 * Hum, line by line: the spectrum averaged over the original's quietest 30 %
 * of frames (where a mains line stands plainest; the same frames of the
 * output, which is aligned), ~1.4 Hz bins. The family (50 or 60) and each
 * harmonic's own frequency (tape speed moves it: 59.83 Hz on 1996-05-10) are
 * found on the original; a line counts when it stands 6 dB over the median
 * of the bins 4..15 Hz either side. Its drop is the power in its peak bin
 * and the bin either side, before minus after.
 */
export function humDrop(orig: Clip, out: Clip): NonNullable<CleanupCheck["hum"]> {
  const fs = orig.fs;
  const xi = monoOf(orig);
  const xo = monoOf(out);
  const N = fs > 30000 ? 32768 : 16384;
  const frames: { from: number; e: number }[] = [];
  for (let from = 0; from + N <= xi.length; from += N / 2) {
    let e = 0;
    for (let i = from; i < from + N; i++) e += xi[i] * xi[i];
    if (e > 0) frames.push({ from, e });
  }
  const pick = [...frames].sort((a, b) => a.e - b.e).slice(0, Math.max(1, Math.ceil(frames.length * 0.3)));
  const si = new Float64Array(N / 2 + 1);
  const so = new Float64Array(N / 2 + 1);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (const f of pick) {
    addPowerSpectrum(xi, f.from, N, si, re, im);
    addPowerSpectrum(xo, f.from, N, so, re, im);
  }
  const binHz = fs / N;
  const peakNear = (f: number) => {
    let best = Math.round(f / binHz);
    for (let k = Math.round((f - 2.5) / binHz); k <= Math.round((f + 2.5) / binHz); k++) if (si[k] > si[best]) best = k;
    return best;
  };
  const prom = (k: number) => {
    const f = k * binHz;
    const around: number[] = [];
    for (let j = Math.round((f - 15) / binHz); j <= Math.round((f - 4) / binHz); j++) around.push(si[j]);
    for (let j = Math.round((f + 4) / binHz); j <= Math.round((f + 15) / binHz); j++) around.push(si[j]);
    around.sort((a, b) => a - b);
    return 10 * Math.log10(si[k] / (around[around.length >> 1] || 1e-30));
  };
  const fam = (base: number) => Array.from({ length: 8 }, (_, i) => peakNear(base * (i + 1)));
  const score = (ks: number[]) => Math.max(...ks.map(prom));
  const k50 = fam(50);
  const k60 = fam(60);
  const family: 50 | 60 = score(k60) >= score(k50) ? 60 : 50;
  const ks = family === 60 ? k60 : k50;
  const lines = ks
    .filter((k) => prom(k) >= 6)
    .map((k) => {
      const b = si[k - 1] + si[k] + si[k + 1];
      const a = so[k - 1] + so[k] + so[k + 1];
      return { freq: k * binHz, dropDb: 10 * Math.log10(b / (a || 1e-30)) };
    });
  return { family, lines, minDrop: lines.length ? Math.min(...lines.map((l) => l.dropDb)) : Infinity };
}

export interface CleanupCheck {
  floorIn: number;
  floorOut: number;
  floorDrop: number;
  hissDrop: number;
  voiceBandDelta: number;
  hum: { family: 50 | 60 | null; lines: { freq: number; dropDb: number }[]; minDrop: number } | null;
  /** Max |change| of an octave band 125 Hz - 8 kHz with content (music clips). */
  musicBandMax: number;
  pass: { floor: boolean; hum: boolean; voice: boolean; music: boolean };
}

export function checkCleanup(orig: Clip, out: Clip, kind: { hissy?: boolean; hummy?: boolean; music?: boolean }): CleanupCheck {
  const mi = measure(orig);
  const mo = measure(out);
  const xi = monoOf(orig);
  const xo = monoOf(out);
  let hum: CleanupCheck["hum"] = null;
  if (kind.hummy) hum = humDrop(orig, out);
  let musicBandMax = 0;
  if (kind.music) {
    const bi = octaveBands(xi, orig.fs);
    const bo = octaveBands(xo, out.fs);
    const top = Math.max(...bi);
    bi.forEach((b, i) => {
      if (b > top - 40) musicBandMax = Math.max(musicBandMax, Math.abs(bo[i] - b));
    });
  }
  return {
    floorIn: mi.noiseFloorDb,
    floorOut: mo.noiseFloorDb,
    floorDrop: mi.noiseFloorDb - mo.noiseFloorDb,
    hissDrop: mi.hissDb - mo.hissDb,
    voiceBandDelta: mo.voiceBandDb - mi.voiceBandDb,
    hum,
    musicBandMax,
    pass: {
      floor: !kind.hissy || mi.noiseFloorDb - mo.noiseFloorDb >= TARGETS.floorDropDb,
      hum: !hum || hum.minDrop >= TARGETS.humDropDb,
      voice: Math.abs(mo.voiceBandDb - mi.voiceBandDb) <= TARGETS.voiceBandDb,
      music: !kind.music || musicBandMax <= TARGETS.musicBandDb,
    },
  };
}
