/**
 * A lookahead peak limiter that holds the reconstructed waveform under a
 * ceiling (true peak, from the 4x detector in oversample.ts).
 *
 * The classic construction, which guarantees the ceiling:
 *   1. required gain r[n] = min(1, ceiling / truePeak(x[n]))
 *   2. m[n] = min of r over the last L samples (a monotonic deque, O(1))
 *   3. e[n] = min(m[n], the released previous value): release only, never attack
 *   4. s[n] = mean of e over the last L samples (a box filter: a smooth ramp)
 *   5. y[n] = x[n - (L - 1)] * s[n]
 * For a peak at p, e[p .. p+L-1] <= r[p], so their mean s[p+L-1] <= r[p], and
 * that is the gain x[p] leaves with. The ramp into a peak lasts L samples; no
 * gain change is ever a step.
 */
import { TAPS_PER_PHASE, TruePeakDetector } from "./oversample.ts";

export interface LimiterOpts {
  fs: number;
  channels: number;
  /** dBTP. Set a little under the promise (the box filter's ramp is linear in gain, not in dB). */
  ceilingDb: number;
  lookaheadMs: number;
  releaseMs: number;
}

export class Limiter {
  readonly latency: number;
  private L: number;
  private ceiling: number;
  private relCoef: number;
  private det: TruePeakDetector[];
  /** Delay lines for the audio, one per channel. */
  private delay: Float64Array[];
  private dpos = 0;
  private dlen: number;
  /** Monotonic deque of (index, value) for the sliding minimum. */
  private dqIdx: Int32Array;
  private dqVal: Float64Array;
  private dqHead = 0;
  private dqTail = 0;
  private n = 0;
  private env = 1;
  private box: Float64Array;
  private boxPos = 0;
  private boxSum: number;
  /** The smallest gain applied since last read, for the meters and the tests. */
  minGain = 1;

  constructor(o: LimiterOpts) {
    this.L = Math.max(1, Math.round((o.lookaheadMs / 1000) * o.fs));
    this.ceiling = Math.pow(10, o.ceilingDb / 20);
    this.relCoef = 1 - Math.exp(-1 / ((o.releaseMs / 1000) * o.fs));
    this.det = Array.from({ length: o.channels }, () => new TruePeakDetector());
    // The detector's own delay is TAPS_PER_PHASE / 2: the audio waits for it too.
    const detDelay = TAPS_PER_PHASE / 2;
    this.dlen = this.L - 1 + detDelay + 1;
    this.latency = this.L - 1 + detDelay;
    this.delay = Array.from({ length: o.channels }, () => new Float64Array(this.dlen));
    this.dqIdx = new Int32Array(this.L + 2);
    this.dqVal = new Float64Array(this.L + 2);
    this.box = new Float64Array(this.L).fill(1);
    this.boxSum = this.L;
  }

  reset(): void {
    for (const d of this.det) d.reset();
    for (const d of this.delay) d.fill(0);
    this.dqHead = this.dqTail = 0;
    this.env = 1;
    this.box.fill(1);
    this.boxSum = this.L;
  }

  /** Process `len` samples of each channel in place. */
  process(ch: Float32Array[], len: number): void {
    const C = ch.length;
    const cap = this.L + 2;
    for (let i = 0; i < len; i++) {
      // Peak of the reconstruction around this sample, over all channels.
      let pk = 0;
      for (let c = 0; c < C; c++) {
        const x = ch[c][i];
        const a = this.det[c].tick(x);
        if (a > pk) pk = a;
        this.delay[c][this.dpos] = x;
      }
      const r = pk > this.ceiling ? this.ceiling / pk : 1;
      // Sliding minimum over the last L samples.
      const n = this.n++;
      while (this.dqTail !== this.dqHead && this.dqVal[(this.dqTail - 1 + cap) % cap] >= r) this.dqTail = (this.dqTail - 1 + cap) % cap;
      this.dqIdx[this.dqTail] = n;
      this.dqVal[this.dqTail] = r;
      this.dqTail = (this.dqTail + 1) % cap;
      while (this.dqIdx[this.dqHead] <= n - this.L) this.dqHead = (this.dqHead + 1) % cap;
      const m = this.dqVal[this.dqHead];
      // Release toward 1, never attack (the box filter does that).
      this.env = Math.min(m, this.env + (1 - this.env) * this.relCoef);
      this.boxSum += this.env - this.box[this.boxPos];
      this.box[this.boxPos] = this.env;
      this.boxPos = (this.boxPos + 1) % this.L;
      const g = this.boxSum / this.L;
      if (g < this.minGain) this.minGain = g;
      const rd = (this.dpos - this.latency + this.dlen) % this.dlen;
      for (let c = 0; c < C; c++) {
        const y = this.delay[c][rd] * g;
        // Belt and braces: the construction above already guarantees this.
        ch[c][i] = y > 1 ? 1 : y < -1 ? -1 : y;
      }
      this.dpos = (this.dpos + 1) % this.dlen;
    }
    // Keep the index from growing without bound on a long show.
    if (this.n > 1e9) {
      const shift = this.n - this.L;
      for (let k = this.dqHead; k !== this.dqTail; k = (k + 1) % cap) this.dqIdx[k] -= shift;
      this.n -= shift;
    }
  }
}
