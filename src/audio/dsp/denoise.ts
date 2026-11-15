/**
 * The hiss reducer: a short-time spectral gate (STFT, 1024 points, hop 256,
 * sqrt-Hann in and out, so overlap-add reconstructs exactly).
 *
 * Per bin, per frame:
 *   - Noise is *learned from quiet passages*: frames well under the running
 *     talking level update it quickly. It is held between 0.5x and 2x of a
 *     minimum-statistics estimate (the smallest smoothed power in the last
 *     ~1.5 s, bias-corrected), so a misjudged "quiet" frame can never teach
 *     it speech, and a show with no pauses still has an estimate.
 *   - Gain is Wiener, from the decision-directed a-priori SNR (Ephraim and
 *     Malah). Its heavy smoothing is what keeps the residual hiss steady
 *     instead of warbling ("musical noise", the underwater sound).
 *   - The gain is smoothed across neighbouring bins and never goes below a
 *     floor: some hiss is left, deliberately, rather than artifacts.
 *     Under 250 Hz the floor is shallower (voices live there, hiss does not).
 *
 * It also computes the speech/music features (music.ts) from the spectra it
 * already has, so the music detector costs almost nothing.
 *
 * Latency is exactly N samples, whatever the block size.
 */
import { fft, hann } from "./fft.ts";

export const N = 1024;
export const HOP = 256;

export interface DenoiseOpts {
  fs: number;
  /** Deepest cut, dB (negative). */
  floorDb: number;
  /** Floor under 250 Hz, dB (negative, shallower). */
  lowFloorDb: number;
}

export const DEFAULT_DENOISE: Omit<DenoiseOpts, "fs"> = { floorDb: -12, lowFloorDb: -5 };

/** Per-frame numbers a caller (the music detector, the tests) may read. */
export interface FrameInfo {
  /** Frame power over 100 Hz .. 8 kHz. */
  power: number;
  /**
   * Partial persistence: the share of this frame's spectral peaks (500 Hz ..
   * 4 kHz, at least 6 dB over the noise estimate) that were also peaks, within
   * a bin, PERSIST_FRAMES ago (~160 ms). Held notes keep their partials;
   * a speaking voice's harmonics glide. -1 when the frame has too few peaks.
   */
  persistence: number;
  /** Frame power after the gate (full strength, before any music easing), 100 Hz .. 8 kHz. */
  cleanPower: number;
  /** Mean applied gain over 300 Hz .. 4 kHz (1 = untouched). */
  voiceGain: number;
}

const BINS = N / 2 + 1;
const SUB_V = 24; // frames per minimum subwindow
const SUB_U = 12; // subwindows: ~1.5 s at 48 kHz
const MS_BIAS = 1.9;
/** ~160 ms of frames at 48 kHz (30 x 5.33 ms). */
export const PERSIST_FRAMES = 30;

export class Denoiser {
  readonly latency = N;
  private fs: number;
  private win: Float64Array;
  private inBuf: Float64Array;
  private outBuf: Float64Array;
  private outQ: Float64Array;
  private cnt = 0;
  private re = new Float64Array(N);
  private im = new Float64Array(N);
  private P = new Float64Array(BINS);
  private noise = new Float64Array(BINS);
  private quietNoise = new Float64Array(BINS);
  private quietAge = 1e9;
  private curMin = new Float64Array(BINS).fill(Infinity);
  private subMins: Float64Array[] = Array.from({ length: SUB_U }, () => new Float64Array(BINS).fill(Infinity));
  private subPos = 0;
  private subCount = 0;
  private prevClean = new Float64Array(BINS);
  private gain = new Float64Array(BINS).fill(1);
  private floor: Float64Array;
  private frames = 0;
  private talk = 0;
  private peakRing: Uint8Array[] = Array.from({ length: PERSIST_FRAMES }, () => new Uint8Array(BINS));
  private peakPos = 0;
  private p0: number;
  private p1: number;
  private lo: number;
  private hi: number;
  private v0: number;
  private v1: number;
  info: FrameInfo = { power: 0, cleanPower: 0, persistence: -1, voiceGain: 1 };
  /** Called once per frame (every HOP samples) with this frame's info. */
  onFrame: ((f: FrameInfo) => void) | null = null;

  constructor(o: DenoiseOpts) {
    this.fs = o.fs;
    const h = hann(N);
    this.win = h.map((v) => Math.sqrt(v));
    this.inBuf = new Float64Array(N);
    this.outBuf = new Float64Array(N);
    this.outQ = new Float64Array(HOP);
    this.floor = new Float64Array(BINS);
    const binHz = o.fs / N;
    for (let k = 0; k < BINS; k++) {
      const f = k * binHz;
      const t = Math.min(1, Math.max(0, (f - 250) / 50));
      this.floor[k] = Math.pow(10, (o.lowFloorDb + t * (o.floorDb - o.lowFloorDb)) / 20);
    }
    this.lo = Math.max(1, Math.round(100 / binHz));
    this.hi = Math.min(BINS - 1, Math.round(8000 / binHz));
    this.v0 = Math.round(300 / binHz);
    this.v1 = Math.min(BINS - 1, Math.round(4000 / binHz));
    this.p0 = Math.round(500 / binHz);
    this.p1 = Math.min(BINS - 2, Math.round(4000 / binHz));
  }

  reset(): void {
    this.inBuf.fill(0);
    this.outBuf.fill(0);
    this.outQ.fill(0);
    this.cnt = 0;
    this.gain.fill(1);
    this.prevClean.fill(0);
    // The noise estimate is kept: hiss belongs to the show, and a seek
    // within it should not have to learn it again.
  }

  /** Forget the noise too (a different show). */
  resetNoise(): void {
    this.reset();
    this.P.fill(0);
    this.noise.fill(0);
    this.quietNoise.fill(0);
    this.quietAge = 1e9;
    this.curMin.fill(Infinity);
    for (const s of this.subMins) s.fill(Infinity);
    this.subCount = 0;
    this.frames = 0;
    this.talk = 0;
  }

  /** Process one channel in place (call once per sample block). */
  process(x: Float32Array, len: number): void {
    for (let i = 0; i < len; i++) {
      this.inBuf[N - HOP + this.cnt] = x[i];
      x[i] = this.outQ[this.cnt];
      if (++this.cnt === HOP) {
        this.cnt = 0;
        this.frame();
      }
    }
  }

  private frame(): void {
    const { re, im, win, P } = this;
    for (let i = 0; i < N; i++) {
      re[i] = this.inBuf[i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    this.frames++;

    // Smoothed periodogram, minimum statistics, frame power.
    let power = 0;
    for (let k = 0; k < BINS; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      P[k] = this.frames === 1 ? p : 0.8 * P[k] + 0.2 * p;
      if (P[k] < this.curMin[k]) this.curMin[k] = P[k];
      if (k >= this.lo && k <= this.hi) power += p;
    }
    if (++this.subCount === SUB_V) {
      this.subCount = 0;
      this.subMins[this.subPos].set(this.curMin);
      this.subPos = (this.subPos + 1) % SUB_U;
      this.curMin.fill(Infinity);
    }

    // The talking level: follows loud frames quickly, sinks slowly.
    const pdb = 10 * Math.log10(power + 1e-20);
    this.talk = pdb > this.talk ? this.talk + 0.2 * (pdb - this.talk) : this.talk - 0.02;
    const quiet = pdb < this.talk - 15;
    this.quietAge = quiet ? 0 : this.quietAge + 1;

    for (let k = 0; k < BINS; k++) {
      let m = this.curMin[k];
      for (let u = 0; u < SUB_U; u++) if (this.subMins[u][k] < m) m = this.subMins[u][k];
      const ms = Number.isFinite(m) ? m * MS_BIAS : P[k];
      if (quiet) this.quietNoise[k] = this.quietNoise[k] > 0 ? 0.9 * this.quietNoise[k] + 0.1 * P[k] : P[k];
      // Quiet passages are the better teacher while they are recent (5 s).
      let n = this.quietAge < 940 && this.quietNoise[k] > 0 ? this.quietNoise[k] : ms;
      n = Math.min(Math.max(n, 0.5 * ms), 2 * ms);
      this.noise[k] = n;
    }

    // Decision-directed Wiener gain.
    const g = this.gain;
    for (let k = 0; k < BINS; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      const n = this.noise[k] + 1e-20;
      const post = p / n;
      let xi = 0.98 * (this.prevClean[k] / n) + 0.02 * Math.max(post - 1, 0);
      if (xi < 0.003) xi = 0.003;
      g[k] = xi / (1 + xi);
    }
    // Across frequency: a 1-2-1 smoothing, then the floor.
    let prev = g[0];
    for (let k = 1; k < BINS - 1; k++) {
      const cur = g[k];
      g[k] = 0.25 * prev + 0.5 * cur + 0.25 * g[k + 1];
      prev = cur;
    }
    let vg = 0;
    let clean = 0;
    for (let k = 0; k < BINS; k++) {
      if (g[k] < this.floor[k]) g[k] = this.floor[k];
      const p = re[k] * re[k] + im[k] * im[k];
      this.prevClean[k] = g[k] * g[k] * p;
      if (k >= this.v0 && k <= this.v1) vg += g[k];
      if (k >= this.lo && k <= this.hi) clean += this.prevClean[k];
    }

    // Partial persistence (see FrameInfo).
    const ring = this.peakRing[this.peakPos];
    const old = this.peakRing[(this.peakPos + 1) % PERSIST_FRAMES];
    ring.fill(0);
    let peaks = 0;
    let kept = 0;
    for (let k = this.p0; k <= this.p1; k++) {
      const pk = re[k] * re[k] + im[k] * im[k];
      const pl = re[k - 1] * re[k - 1] + im[k - 1] * im[k - 1];
      const pr = re[k + 1] * re[k + 1] + im[k + 1] * im[k + 1];
      if (pk > pl && pk > pr && pk > 4 * this.noise[k]) {
        ring[k] = 1;
        peaks++;
        if (old[k - 1] || old[k] || old[k + 1]) kept++;
      }
    }
    this.peakPos = (this.peakPos + 1) % PERSIST_FRAMES;
    this.info = { power, cleanPower: clean, persistence: peaks >= 4 ? kept / peaks : -1, voiceGain: vg / (this.v1 - this.v0 + 1) };
    this.onFrame?.(this.info);

    // Apply (Hermitian: mirror the gain), invert, window, overlap-add.
    for (let k = 0; k < BINS; k++) {
      re[k] *= g[k];
      im[k] *= g[k];
      if (k > 0 && k < N / 2) {
        re[N - k] *= g[k];
        im[N - k] *= g[k];
      }
    }
    for (let i = 0; i < N; i++) im[i] = -im[i];
    fft(re, im);
    // ifft = conj(fft(conj)) / N; only the real part is needed.
    const scale = 1 / N / 2; // and 1/2: sqrt-Hann squared overlaps to 2 at hop N/4
    for (let i = 0; i < N; i++) this.outBuf[i] += re[i] * scale * win[i];
    this.outQ.set(this.outBuf.subarray(0, HOP));
    this.outBuf.copyWithin(0, HOP);
    this.outBuf.fill(0, N - HOP);
    this.inBuf.copyWithin(0, HOP);
  }
}
