/**
 * Mains hum: found, then notched, only where it is actually there.
 *
 * Detection runs on a copy decimated to about 2 kHz, low-passed at 600 Hz
 * first (the 8th harmonic of 60 Hz is 480 Hz: a 440 Hz filter on a 1 kHz
 * copy hid it, measured on 1996-05-10). Every half second a 1 s Hann frame
 * (2,048 points, ~1 Hz bins) is taken; only frames quieter than the running median are
 * averaged, because hum is plainest in the pauses and speech or music
 * harmonics wander while a mains line does not. A line is a harmonic of 50
 * or 60 Hz whose averaged power stands DETECT_DB over the median of the bins
 * 4..15 Hz either side; its exact frequency comes from a parabola through
 * the peak bin and its neighbours (tape speed moves hum off 60.00 Hz).
 *
 * Each detected line gets two identical notches in series, so the cut stays
 * over 20 dB within a few tenths of a hertz of the estimate. A notch is
 * written y = x - d * bandpass(x): with depth d = 1 it is exactly a notch,
 * and d ramps over ~0.3 s, so a line engaging or letting go never clicks.
 * Lines engage at DETECT_DB and release only after RELEASE_EVALS evaluations
 * under RELEASE_DB (hysteresis), and new lines are not engaged while the
 * music detector says music (a held bass note at 120 Hz is not hum).
 */
import { Biquad, type BiquadCoefs, lowPass } from "./biquad.ts";
import { addPowerSpectrum } from "./fft.ts";

export const DETECT_DB = 10;
/**
 * Once a family is established (a line at DETECT_DB), its other harmonics
 * engage at this, if they sit within FAMILY_TOL_HZ of k times the fundamental
 * the strong lines agree on. A weak harmonic exactly where the mains puts it
 * is the mains (1996-05-10: the 8th sat at 9-12 dB for a minute).
 */
export const FAMILY_DB = 6;
const FAMILY_TOL_HZ = 1;
export const RELEASE_DB = 5;
const RELEASE_EVALS = 20; // 10 s
const HARMONICS = 8;
const FFT = 2048;
const EVAL_EVERY = 0.5; // s

/** A unity-peak bandpass (RBJ constant 0 dB peak): 1 - this is the notch. */
function bandpass(fs: number, f0: number, bwHz: number): BiquadCoefs {
  const q = f0 / bwHz;
  const w = (2 * Math.PI * f0) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

interface Line {
  k: number;
  freq: number;
  depth: number;
  want: number;
  quietEvals: number;
  bp: Biquad[][]; // [channel][stage]
}

export interface HumStatus {
  family: 50 | 60 | null;
  lines: { k: number; freq: number; prominence: number; depth: number }[];
}

export class HumRemover {
  private fs: number;
  private channels: number;
  private D: number;
  private decFs: number;
  private aa: Biquad[];
  private phase = 0;
  private ring = new Float64Array(FFT);
  private rpos = 0;
  private sinceEval = 0;
  private evalLen: number;
  private avg = new Float64Array(FFT / 2 + 1);
  private avgN = 0;
  private energies: number[] = [];
  private lines = new Map<number, Line>();
  private family: 50 | 60 | null = null;
  private lastProm = new Map<number, number>();
  private depthStep: number;
  /** Set by the caller from the music detector: no new lines while true. */
  musicNow = false;

  constructor(fs: number, channels = 2) {
    this.fs = fs;
    this.channels = channels;
    this.D = Math.max(1, Math.round(fs / 2000));
    this.decFs = fs / this.D;
    this.aa = [0, 1, 2].map(() => new Biquad(lowPass(fs, 600, 0.7071)));
    this.evalLen = Math.round(EVAL_EVERY * this.decFs);
    this.depthStep = 1 / (0.3 * fs);
  }

  reset(): void {
    this.avg.fill(0);
    this.avgN = 0;
    this.energies = [];
    this.lines.clear();
    this.family = null;
    this.ring.fill(0);
    for (const b of this.aa) b.reset();
  }

  status(): HumStatus {
    return {
      family: this.family,
      lines: [...this.lines.values()].map((l) => ({ k: l.k, freq: l.freq, prominence: this.lastProm.get(l.k) ?? 0, depth: l.depth })),
    };
  }

  /** Feed the detector with the mono mix (one call per block). */
  analyse(mono: Float32Array, len: number): void {
    for (let i = 0; i < len; i++) {
      const y = this.aa[2].tick(this.aa[1].tick(this.aa[0].tick(mono[i])));
      if (++this.phase < this.D) continue;
      this.phase = 0;
      this.ring[this.rpos] = y;
      this.rpos = (this.rpos + 1) % FFT;
      if (++this.sinceEval >= this.evalLen) {
        this.sinceEval = 0;
        this.evaluate();
      }
    }
  }

  private evaluate(): void {
    // The last FFT decimated samples, in order.
    const frame = new Float64Array(FFT);
    let e = 0;
    for (let i = 0; i < FFT; i++) {
      const v = this.ring[(this.rpos + i) % FFT];
      frame[i] = v;
      e += v * v;
    }
    if (e <= 0) return;
    this.energies.push(e);
    if (this.energies.length > 40) this.energies.shift();
    const sorted = [...this.energies].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    if (this.energies.length >= 4 && e > median) return; // only the quiet half teaches
    const spec = new Float64Array(FFT / 2 + 1);
    addPowerSpectrum(frame, 0, FFT, spec);
    // A running average with a memory of about 12 quiet frames.
    const a = this.avgN < 12 ? 1 / ++this.avgN : 1 / 12;
    for (let k = 0; k < spec.length; k++) this.avg[k] += (spec[k] - this.avg[k]) * a;
    if (this.avgN < 4) return;

    const binHz = this.decFs / FFT;
    const lineAt = (f: number) => {
      const c = Math.round(f / binHz);
      let best = c;
      for (let k = c - 2; k <= c + 2; k++) if ((this.avg[k] ?? 0) > (this.avg[best] ?? 0)) best = k;
      const around: number[] = [];
      for (let k = Math.round((f - 15) / binHz); k <= Math.round((f - 4) / binHz); k++) around.push(this.avg[k] ?? 0);
      for (let k = Math.round((f + 4) / binHz); k <= Math.round((f + 15) / binHz); k++) around.push(this.avg[k] ?? 0);
      around.sort((x, y) => x - y);
      const med = around[around.length >> 1] || 1e-30;
      const p = this.avg[best] ?? 0;
      // Parabolic interpolation on log power for the true frequency.
      const l = Math.log((this.avg[best - 1] ?? 0) + 1e-30);
      const m = Math.log(p + 1e-30);
      const r = Math.log((this.avg[best + 1] ?? 0) + 1e-30);
      const den = l - 2 * m + r;
      const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0;
      return { prom: 10 * Math.log10(p / med + 1e-30), freq: (best + off) * binHz };
    };
    // The fundamental the engaged lines agree on (their frequency over k,
    // weighted by prominence): the established family's harmonics are looked
    // for at k times it, not at k times 50 or 60 (59.7 Hz puts the 8th at
    // 477.6, outside a search around 480), and weaker ones judged by it.
    let f0 = 0;
    let w = 0;
    for (const l of this.lines.values()) {
      const p = Math.max(0, this.lastProm.get(l.k) ?? 0);
      if (l.want > 0 && p >= DETECT_DB) {
        f0 += (l.freq / l.k) * p;
        w += p;
      }
    }
    f0 = w > 0 ? f0 / w : 0;

    const scan = (base: 50 | 60) => {
      const fund = this.family === base && f0 > 0 ? f0 : base;
      return Array.from({ length: HARMONICS }, (_, i) => lineAt(fund * (i + 1))).filter((x) => x.freq < this.decFs / 2 - 20);
    };
    const s50 = scan(50);
    const s60 = scan(60);
    const best = (s: { prom: number }[]) => Math.max(...s.map((x) => x.prom));
    const fam: 50 | 60 = best(s60) >= best(s50) ? 60 : 50;
    const s = fam === 60 ? s60 : s50;
    if (this.family !== fam && this.lines.size) {
      // The other family won: let the current lines go.
      for (const l of this.lines.values()) l.want = 0;
    }
    this.family = best(s) >= DETECT_DB ? fam : this.family;

    s.forEach((h, i) => {
      const k = i + 1;
      const inFamily = f0 > 0 && Math.abs(h.freq - k * f0) <= FAMILY_TOL_HZ;
      const engageAt = inFamily ? FAMILY_DB : DETECT_DB;
      this.lastProm.set(k, h.prom);
      const line = this.lines.get(k);
      if (line && this.family === fam) {
        if (h.prom >= RELEASE_DB) {
          line.quietEvals = 0;
          line.want = 1;
          // Follow a drifting line (only while it is plainly there).
          if (h.prom >= DETECT_DB && Math.abs(h.freq - line.freq) < 1.5) this.retune(line, 0.7 * line.freq + 0.3 * h.freq);
        } else if (++line.quietEvals >= RELEASE_EVALS) line.want = 0;
      } else if (!line && h.prom >= engageAt && !this.musicNow && this.family === fam) {
        this.lines.set(k, this.makeLine(k, inFamily ? 0.5 * (h.freq + k * f0) : h.freq));
      }
    });
  }

  private bw(k: number): number {
    return 2.5 + 0.4 * (k - 1);
  }

  private makeLine(k: number, freq: number): Line {
    const c = bandpass(this.fs, freq, this.bw(k));
    return { k, freq, depth: 0, want: 1, quietEvals: 0, bp: Array.from({ length: this.channels }, () => [new Biquad(c), new Biquad(c)]) };
  }

  private retune(l: Line, freq: number): void {
    if (Math.abs(freq - l.freq) < 0.02) return;
    l.freq = freq;
    const c = bandpass(this.fs, freq, this.bw(l.k));
    for (const ch of l.bp) for (const b of ch) b.c = c;
  }

  /** Notch every engaged line, channel by channel, in place. */
  process(ch: Float32Array[], len: number): void {
    for (const [k, l] of this.lines) {
      for (let c = 0; c < ch.length && c < l.bp.length; c++) {
        const x = ch[c];
        const [b1, b2] = l.bp[c];
        let d = l.depth;
        for (let i = 0; i < len; i++) {
          d += d < l.want ? this.depthStep : d > l.want ? -this.depthStep : 0;
          if (d < 0) d = 0;
          else if (d > 1) d = 1;
          const y1 = x[i] - d * b1.tick(x[i]);
          x[i] = y1 - d * b2.tick(y1);
        }
        if (c === ch.length - 1 || c === l.bp.length - 1) l.depth = d;
      }
      if (l.want === 0 && l.depth === 0) this.lines.delete(k);
    }
  }
}
