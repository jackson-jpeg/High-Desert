/**
 * The leveling compressor: the stage after the slow loudness AGC that evens
 * out phrase-to-phrase level, the way a broadcast "talk" processor does.
 * Soft knee, RMS detector (~50 ms, a phrase's level rather than a
 * syllable's), linked channels, slow release.
 *
 * Gated: when a fast detector falls well under the talking level (a pause
 * between phrases, dead air), the gain stops following the signal. An
 * ungated compressor recovers during every pause, lifting the hiss and room
 * under the talk: that rise and fall is "breathing", the sound of an app
 * filter. In the gate the gain may only come down, toward the phrase's
 * average reduction, never up: a plain hold keeps the gain of the last,
 * quietest syllable (1.2 to 2 dB above the phrase's on the archive
 * openings), and settling both ways lifted the floor after every loud last
 * word by as much.
 *
 * Not DynamicsCompressorNode: that differs between browsers (Chromium's has
 * a hidden makeup gain and a pre-delay), and this has to sound the same
 * everywhere and in the offline renders.
 *
 * The gain is computed once per SUB samples and interpolated, which keeps
 * the log/pow work off the per-sample path (an old phone's budget).
 */

import { Biquad, kWeighting } from "./biquad.ts";

export interface CompressorOpts {
  fs: number;
  thresholdDb: number;
  ratio: number;
  kneeDb: number;
  attackMs: number;
  releaseMs: number;
  makeupDb: number;
  /** RMS detector time constant. */
  rmsMs: number;
  /**
   * The gate: when a fast (10 ms) level falls this far under the running
   * talk level, or under the threshold by this much, the gain is held.
   */
  gateBelowDb: number;
  /** Detect on K-weighted audio (loudness as BS.1770 hears it), not plain RMS. */
  kWeighted?: boolean;
}

const SUB = 16;

export class Compressor {
  private o: CompressorOpts;
  private att: number;
  private rel: number;
  private det: number;
  private ms = 0;
  private fastMs = 0;
  private fastDet: number;
  /** The talking level the gate is relative to, dB: follows ungated speech slowly. */
  private talkDb = -30;
  private talkA: number;
  /** The phrase's average gain reduction: where the gate settles the gain. */
  private avgGr = 0;
  private avgA: number;
  private gateA: number;
  private grDb = 0;
  private makeup: number;
  private gNow: number;
  private gStep = 0;
  private sub = 0;
  private kw: Biquad[] | null;
  /** Deepest gain reduction since last read, dB (positive). */
  maxGrDb = 0;
  /** True while the gate is holding. */
  gated = false;

  constructor(o: CompressorOpts) {
    this.o = o;
    const step = SUB / o.fs;
    this.att = 1 - Math.exp(-step / (o.attackMs / 1000));
    this.rel = 1 - Math.exp(-step / (o.releaseMs / 1000));
    this.det = 1 - Math.exp(-1 / ((o.rmsMs / 1000) * o.fs));
    this.fastDet = 1 - Math.exp(-1 / (0.01 * o.fs));
    this.talkA = 1 - Math.exp(-step / 2);
    this.avgA = 1 - Math.exp(-step / 1);
    this.gateA = 1 - Math.exp(-step / 0.15);
    this.makeup = Math.pow(10, o.makeupDb / 20);
    this.gNow = this.makeup;
    this.kw = o.kWeighted ? kWeighting(o.fs).map((c) => new Biquad(c)) : null;
  }

  reset(): void {
    this.ms = 0;
    this.fastMs = 0;
    this.talkDb = -30;
    this.avgGr = 0;
    this.grDb = 0;
    this.gNow = this.makeup;
    this.gStep = 0;
    this.sub = 0;
    this.gated = false;
    if (this.kw) for (const b of this.kw) b.reset();
  }

  /** Current gain reduction, dB (positive). */
  get gainReductionDb(): number {
    return this.grDb;
  }

  /** Static curve: gain reduction in dB (>= 0) for an input level in dB. */
  static curve(levelDb: number, t: number, ratio: number, knee: number): number {
    const over = levelDb - t;
    if (2 * over <= -knee) return 0;
    if (2 * over >= knee) return over - over / ratio;
    const x = over + knee / 2;
    return ((1 - 1 / ratio) * x * x) / (2 * knee);
  }

  process(ch: Float32Array[], len: number): void {
    const { thresholdDb, ratio, kneeDb, gateBelowDb } = this.o;
    const L = ch[0];
    const R = ch.length > 1 ? ch[1] : ch[0];
    const det = this.det;
    for (let i = 0; i < len; i++) {
      const a = L[i];
      const b = R[i];
      let p: number;
      if (this.kw) {
        const k = this.kw[1].tick(this.kw[0].tick(0.5 * (a + b)));
        p = k * k;
      } else p = 0.5 * (a * a + b * b);
      this.ms += (p - this.ms) * det;
      this.fastMs += (p - this.fastMs) * this.fastDet;
      if (++this.sub === SUB) {
        this.sub = 0;
        const lvl = 10 * Math.log10(this.ms + 1e-12);
        const fast = 10 * Math.log10(this.fastMs + 1e-12);
        this.gated = fast < thresholdDb - gateBelowDb || fast < this.talkDb - gateBelowDb;
        if (!this.gated) {
          this.talkDb += (lvl - this.talkDb) * this.talkA;
          const want = Compressor.curve(lvl, thresholdDb, ratio, kneeDb);
          this.grDb += (want - this.grDb) * (want > this.grDb ? this.att : this.rel);
          if (this.grDb > this.maxGrDb) this.maxGrDb = this.grDb;
          this.avgGr += (this.grDb - this.avgGr) * this.avgA;
        } else if (this.avgGr > this.grDb) {
          // In a pause the gain may only come *down*, toward the phrase's
          // average reduction: after a soft last syllable it settles there
          // (the pause sits where the talk around it sits); after a loud
          // last word it holds. It never rises in a pause, which is what
          // breathing is.
          this.grDb += (this.avgGr - this.grDb) * this.gateA;
        }
        const gNext = Math.pow(10, -this.grDb / 20) * this.makeup;
        this.gStep = (gNext - this.gNow) / SUB;
      }
      this.gNow += this.gStep;
      L[i] = a * this.gNow;
      if (R !== L) R[i] = b * this.gNow;
    }
  }
}
