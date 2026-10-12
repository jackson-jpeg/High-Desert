/**
 * The arithmetic of a Web Audio AnalyserNode, for PCM the level tap decoded
 * itself: time-domain bytes, and frequency bytes as the spec defines them
 * (Blackman window, FFT, magnitude over N, smoothing over time, decibels
 * scaled between minDecibels and maxDecibels). The visualizers were written
 * against a real AnalyserNode on desktop; this gives them the same numbers
 * for the same sound, so none of them needs to know which it has.
 */

export const FFT_SIZE = 2048;
export const MIN_DB = -100;
export const MAX_DB = -30;
export const SMOOTHING = 0.8;

const blackman = (() => {
  const w = new Float32Array(FFT_SIZE);
  const a0 = 0.42;
  const a1 = 0.5;
  const a2 = 0.08;
  for (let n = 0; n < FFT_SIZE; n++) {
    w[n] = a0 - a1 * Math.cos((2 * Math.PI * n) / FFT_SIZE) + a2 * Math.cos((4 * Math.PI * n) / FFT_SIZE);
  }
  return w;
})();

/** In-place iterative radix-2 FFT; `re.length` must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Float samples (-1..1) as an AnalyserNode's time-domain bytes (128 is silence). */
export function timeDomainBytes(samples: Float32Array, out: Uint8Array): void {
  const n = Math.min(out.length, samples.length);
  for (let i = 0; i < n; i++) {
    const v = 128 * (1 + samples[i]);
    out[i] = v <= 0 ? 0 : v >= 255 ? 255 : v;
  }
}

/** Frequency analysis with the AnalyserNode's smoothing memory. */
export class SpectrumState {
  private readonly smoothed = new Float32Array(FFT_SIZE / 2);
  private readonly re = new Float32Array(FFT_SIZE);
  private readonly im = new Float32Array(FFT_SIZE);

  /** `samples` is the last FFT_SIZE samples; writes frequencyBinCount bytes into `out`. */
  frequencyBytes(samples: Float32Array, out: Uint8Array): void {
    const { re, im, smoothed } = this;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (samples[i] ?? 0) * blackman[i];
      im[i] = 0;
    }
    fft(re, im);
    const bins = Math.min(out.length, FFT_SIZE / 2);
    const range = MAX_DB - MIN_DB;
    for (let k = 0; k < FFT_SIZE / 2; k++) {
      const mag = Math.hypot(re[k], im[k]) / FFT_SIZE;
      smoothed[k] = SMOOTHING * smoothed[k] + (1 - SMOOTHING) * mag;
      if (k >= bins) continue;
      const db = smoothed[k] > 0 ? 20 * Math.log10(smoothed[k]) : -Infinity;
      const v = (255 / range) * (db - MIN_DB);
      out[k] = v <= 0 ? 0 : v >= 255 ? 255 : v;
    }
  }

  reset(): void {
    this.smoothed.fill(0);
  }
}
