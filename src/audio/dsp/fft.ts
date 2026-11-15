/**
 * An in-place radix-2 complex FFT with cached tables, and a real-input power
 * spectrum on top. Small and dependency-free so it runs inside an
 * AudioWorklet as well as in Node.
 */

interface Tables {
  cos: Float64Array;
  sin: Float64Array;
  rev: Uint32Array;
}

const cache = new Map<number, Tables>();

function tables(n: number): Tables {
  let t = cache.get(n);
  if (t) return t;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  cache.set(n, t);
  return t;
}

/** Forward FFT of (re, im), in place. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { cos, sin, rev } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Inverse FFT, in place, scaled by 1/n. */
export function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

const windows = new Map<number, Float64Array>();

/** A periodic Hann window of length n (cached). */
export function hann(n: number): Float64Array {
  let w = windows.get(n);
  if (w) return w;
  w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  windows.set(n, w);
  return w;
}

/**
 * Hann-windowed power spectrum of x[from .. from+n), bins 0..n/2, added into
 * `acc` (so several frames can be averaged). Scaled so a full-scale sine reads
 * about 0 dB at its bin (window coherent gain removed).
 */
export function addPowerSpectrum(x: ArrayLike<number>, from: number, n: number, acc: Float64Array, re = new Float64Array(n), im = new Float64Array(n)): void {
  const w = hann(n);
  for (let i = 0; i < n; i++) {
    re[i] = (x[from + i] ?? 0) * w[i];
    im[i] = 0;
  }
  fft(re, im);
  const scale = 4 / (n * n); // (2/(n*0.5))^2 for a Hann window
  for (let k = 0; k <= n / 2; k++) acc[k] += (re[k] * re[k] + im[k] * im[k]) * scale;
}
