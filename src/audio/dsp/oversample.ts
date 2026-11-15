/**
 * Inter-sample ("true") peaks, by 4x polyphase interpolation in the manner of
 * ITU-R BS.1770-4 Annex 2: 48 taps, 12 per phase. A sample peak can read
 * −1.5 dBFS while the reconstructed waveform crosses 0 dBFS; a limiter that
 * promises −1 dBTP has to look between the samples.
 */

export const PHASES = 4;
export const TAPS_PER_PHASE = 12;

function besselI0(x: number): number {
  let s = 1;
  let t = 1;
  for (let k = 1; k < 30; k++) {
    t *= (x / (2 * k)) ** 2;
    s += t;
  }
  return s;
}

/** phase[p][k]: the k-th tap of phase p. Each phase sums to 1 (DC passes exactly). */
function design(): Float64Array[] {
  const M = PHASES * TAPS_PER_PHASE;
  const fc = 0.5 / PHASES * 0.94; // pass to ~94 % of the original Nyquist
  const beta = 7;
  const h = new Float64Array(M);
  for (let n = 0; n < M; n++) {
    const t = n - (M - 1) / 2;
    const sinc = t === 0 ? 1 : Math.sin(2 * Math.PI * fc * t) / (2 * Math.PI * fc * t);
    const r = (2 * n) / (M - 1) - 1;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
    h[n] = sinc * w;
  }
  const phases: Float64Array[] = [];
  for (let p = 0; p < PHASES; p++) {
    const ph = new Float64Array(TAPS_PER_PHASE);
    let s = 0;
    for (let k = 0; k < TAPS_PER_PHASE; k++) {
      ph[k] = h[k * PHASES + p];
      s += ph[k];
    }
    for (let k = 0; k < TAPS_PER_PHASE; k++) ph[k] /= s;
    phases.push(ph);
  }
  return phases;
}

const PH = design();

/**
 * Streaming detector: feed samples one at a time, get the largest absolute
 * value of the reconstructed waveform around each (the sample itself included).
 * Its delay is TAPS_PER_PHASE / 2 samples, which callers align for.
 */
export class TruePeakDetector {
  private hist = new Float64Array(TAPS_PER_PHASE);
  private pos = 0;
  reset(): void {
    this.hist.fill(0);
    this.pos = 0;
  }
  tick(x: number): number {
    const h = this.hist;
    h[this.pos] = x;
    let peak = 0;
    for (let p = 0; p < PHASES; p++) {
      const ph = PH[p];
      let y = 0;
      let j = this.pos;
      for (let k = 0; k < TAPS_PER_PHASE; k++) {
        y += ph[k] * h[j];
        j = j === 0 ? TAPS_PER_PHASE - 1 : j - 1;
      }
      const a = Math.abs(y);
      if (a > peak) peak = a;
    }
    this.pos = (this.pos + 1) % TAPS_PER_PHASE;
    return peak;
  }
}

/** The true peak of a whole channel, dBTP. */
export function truePeakOf(x: Float32Array | Float64Array): number {
  const d = new TruePeakDetector();
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    const t = d.tick(x[i]);
    if (t > peak) peak = t;
  }
  for (let i = 0; i < TAPS_PER_PHASE; i++) {
    const t = d.tick(0);
    if (t > peak) peak = t;
  }
  return 20 * Math.log10(peak || 1e-12);
}
