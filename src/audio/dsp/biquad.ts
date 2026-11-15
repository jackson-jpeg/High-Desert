/**
 * Second-order IIR sections: design (RBJ Audio EQ Cookbook, and the BS.1770
 * K-weighting pair) and processing. Pure, no Web Audio: the same code runs in
 * the AudioWorklet, in Node for the offline renders, and in the tests.
 *
 * Coefficients are normalised (a0 = 1). Processing is transposed direct form
 * II, in double precision, which stays quiet for the low corner frequencies
 * here (a 38 Hz high-pass at 48 kHz) where direct form I in float32 would not.
 */

export interface BiquadCoefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function norm(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): BiquadCoefs {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export function highPass(fs: number, f0: number, q: number): BiquadCoefs {
  const w = (2 * Math.PI * f0) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return norm((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}

export function lowPass(fs: number, f0: number, q: number): BiquadCoefs {
  const w = (2 * Math.PI * f0) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return norm((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}

/** A notch: unity everywhere but a null at f0, `q` = f0 / bandwidth. */
export function notch(fs: number, f0: number, q: number): BiquadCoefs {
  const w = (2 * Math.PI * f0) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return norm(1, -2 * c, 1, 1 + alpha, -2 * c, 1 - alpha);
}

/** Peaking EQ: `gainDb` at f0 (negative cuts), unity far from it. */
export function peaking(fs: number, f0: number, gainDb: number, q: number): BiquadCoefs {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f0) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return norm(1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A);
}

/**
 * The two K-weighting stages of ITU-R BS.1770, derived for any sample rate
 * the way libebur128 does it (its constants reproduce the standard's 48 kHz
 * table exactly). The browser runs at 44.1 or 48 kHz, so the table alone is
 * not enough.
 */
export function kWeighting(fs: number): [BiquadCoefs, BiquadCoefs] {
  // Stage 1: the head's high-frequency shelf, about +4 dB above 2 kHz.
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf: BiquadCoefs = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // Stage 2: the RLB high-pass, about 38 Hz.
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / fs);
  const d = 1 + K1 / Q1 + K1 * K1;
  const hp: BiquadCoefs = { b0: 1, b1: -2, b2: 1, a1: (2 * (K1 * K1 - 1)) / d, a2: (1 - K1 / Q1 + K1 * K1) / d };
  return [shelf, hp];
}

/** One section's memory. */
export class Biquad {
  c: BiquadCoefs;
  z1 = 0;
  z2 = 0;
  constructor(c: BiquadCoefs) {
    this.c = c;
  }
  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
  /** One sample. */
  tick(x: number): number {
    const c = this.c;
    const y = c.b0 * x + this.z1;
    this.z1 = c.b1 * x - c.a1 * y + this.z2;
    this.z2 = c.b2 * x - c.a2 * y;
    return y;
  }
  /** A block, in place, from `from` to `to`. */
  run(buf: Float32Array | Float64Array, from = 0, to = buf.length): void {
    const { b0, b1, b2, a1, a2 } = this.c;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = from; i < to; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    // Denormals: a filter ringing down to nothing must not cost a fortune.
    this.z1 = Math.abs(z1) < 1e-25 ? 0 : z1;
    this.z2 = Math.abs(z2) < 1e-25 ? 0 : z2;
  }
}

/** |H(e^jw)| in dB at frequency f, for checking a design. */
export function magnitudeDb(c: BiquadCoefs, fs: number, f: number): number {
  const w = (2 * Math.PI * f) / fs;
  const cr = (k: number) => Math.cos(k * w);
  const ci = (k: number) => -Math.sin(k * w);
  const nr = c.b0 + c.b1 * cr(1) + c.b2 * cr(2);
  const ni = c.b1 * ci(1) + c.b2 * ci(2);
  const dr = 1 + c.a1 * cr(1) + c.a2 * cr(2);
  const di = c.a1 * ci(1) + c.a2 * ci(2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}
