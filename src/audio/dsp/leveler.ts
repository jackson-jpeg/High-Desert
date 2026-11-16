/**
 * Level: a loudness AGC, then a gentle compressor, then a true-peak limiter.
 *
 * The AGC reads K-weighted loudness (BS.1770, as played: a mono file arrives
 * here up-mixed to two identical channels) and steers toward TARGET_LUFS:
 *
 *   - Slow path: the loudness of the last 3 s of *active* audio (100 ms
 *     blocks that pass the gate). Silence never drags it down, so a pause
 *     does not make the next word arrive boosted.
 *   - Fast path: the momentary (400 ms) loudness may sit at most
 *     momentaryHeadroom above the target. A hot caller trips it.
 *   - The gain rises slowly (riseTau, capped at riseCap dB/s) and falls
 *     fast (fallTau), within +MAX_BOOST / -MAX_CUT.
 *   - It freezes when the input is quiet (below -60 LUFS, or LEVEL_AGC.gateBelow
 *     under the active loudness): dead air and hiss are never pumped up.
 *   - It looks LOOKAHEAD_MS ahead: the audio is delayed, the detector is not,
 *     so the fall begins as the caller does rather than after.
 *
 * Everything here is pure and block-agnostic; the worklet and the offline
 * renderer drive the same code.
 */
import { Biquad, kWeighting } from "./biquad.ts";
import { Compressor } from "./compressor.ts";
import { Limiter } from "./limiter.ts";

export const TARGET_LUFS = -16;
export const MAX_BOOST = 12;
export const MAX_CUT = 10;
/**
 * The AGC's timing. Mutable only so the tuning script can try settings;
 * the app never changes it.
 *   riseTau/riseCap: how fast the gain climbs (s, dB/s)
 *   fallTau/fallCap: how fast it drops (s, dB/s)
 *   momentaryHeadroom: a 400 ms burst this far over the target cuts at once
 *   gateAbs/gateBelow: frozen below -60 LUFS, or this far under the talk
 *   talkerChangeDb: the newest second of talk this far from the 3 s mean is
 *     a new talker, and becomes the estimate (slowEstimate)
 */
export const LEVEL_AGC = { riseTau: 1.0, riseCap: 6, fallTau: 0.3, fallCap: 30, momentaryHeadroom: 5, gateAbs: -60, gateBelow: 22, talkerChangeDb: 4 };
export const LOOKAHEAD_MS = 200;
/** The handover between the live AGC and the envelope (setExternal). */
export const EXT_RAMP_MS = 300;
export const CEILING_DBTP = -1.3; // the promise is -1 dBTP; a little margin
/**
 * The leveling compressor after the AGC (compressor.ts). The AGC sets each
 * 3 s to the target; this evens out the phrases inside them. Mutable only
 * so the tuning script can try settings; the app never changes it.
 */
export const LEVEL_COMP = { thresholdDb: -30, ratio: 4, kneeDb: 10, attackMs: 20, releaseMs: 500, makeupDb: 10.5, rmsMs: 50, gateBelowDb: 7, kWeighted: true };
/** The AGC gain's per-sample smoothing time constant, seconds. */
const GAIN_SMOOTH_S = 0.02;

const HOP_MS = 25;
/** A talker change is judged on the newest second of talk (LEVEL_AGC.talkerChangeDb from the 3 s mean). */
const TALKER_CHANGE_BLOCKS = 10;
const BLOCK_MS = 100;

const lufs = (ms: number) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);

export interface LevelerState {
  gainDb: number;
  targetDb: number;
  frozen: boolean;
  activeLufs: number;
  momentaryLufs: number;
}

export class Leveler {
  readonly fs: number;
  readonly latency: number;
  private kw: Biquad[][];
  private hop: number;
  private hopCount = 0;
  private hopAcc = 0;
  /** Momentary: the last 16 hops (400 ms) of K-weighted mean square. */
  private mom = new Float64Array(16);
  private momPos = 0;
  /** Blocks of 100 ms being built from hops. */
  private blockAcc = 0;
  private blockHops = 0;
  /** The last 30 active 100 ms blocks (3 s of speech). */
  private active = new Float64Array(30);
  private activeN = 0;
  private activePos = 0;
  private gainDb: number;
  private targetDb: number;
  private frozen = false;
  private lastBlockActive = false;
  /** Seconds of active audio measured since the last reset: fast acquisition until 3 s. */
  private learned = 0;
  private lastGain: number;
  private smooth: number;
  private delay: Float32Array[];
  private dpos = 0;
  private dlen: number;
  private look: number;
  readonly comp: Compressor;
  readonly lim: Limiter;
  private cur: LevelerState;
  /**
   * Two-pass Level (src/lib/audio/level-envelope.ts): the gain comes from the
   * show's envelope on a GainNode upstream, so the live AGC and the
   * compressor step aside and only the limiter acts. `ext` is how far aside
   * (0..1, ramped over EXT_RAMP_MS); `extDelay` holds a change back until the
   * audio that had the new upstream gain reaches this stage.
   */
  private ext = 0;
  private extWant = false;
  private extDelay = 0;
  private extStep: number;
  private pre: Float32Array[] = [new Float32Array(128), new Float32Array(128)];

  constructor(fs: number, initialGainDb = 0) {
    this.fs = fs;
    this.kw = [0, 1].map(() => kWeighting(fs).map((c) => new Biquad(c)));
    this.hop = Math.round((HOP_MS / 1000) * fs);
    this.look = Math.round((LOOKAHEAD_MS / 1000) * fs);
    this.dlen = this.look + 1;
    this.delay = [new Float32Array(this.dlen), new Float32Array(this.dlen)];
    this.gainDb = this.targetDb = clamp(initialGainDb);
    this.lastGain = Math.pow(10, this.gainDb / 20);
    this.comp = new Compressor({ fs, ...LEVEL_COMP });
    this.smooth = 1 - Math.exp(-1 / (GAIN_SMOOTH_S * fs));
    this.lim = new Limiter({ fs, channels: 2, ceilingDb: CEILING_DBTP, lookaheadMs: 5, releaseMs: 80 });
    this.latency = this.look + this.lim.latency;
    this.extStep = 1 / ((EXT_RAMP_MS / 1000) * fs);
    this.cur = { gainDb: this.gainDb, targetDb: this.gainDb, frozen: false, activeLufs: -Infinity, momentaryLufs: -Infinity };
  }

  /**
   * Hand the gain to the envelope upstream (true) or take it back (false).
   * `afterSamples`: start the ramp once that much audio has passed (the
   * stages before this one plus this one's lookahead); `now`: no ramp, for
   * a moment the output is ducked anyway (a new show).
   */
  setExternal(on: boolean, opts: { afterSamples?: number; now?: boolean } = {}): void {
    this.extWant = on;
    if (opts.now) {
      this.ext = on ? 1 : 0;
      this.extDelay = 0;
    } else this.extDelay = Math.max(0, Math.round(opts.afterSamples ?? this.look));
  }

  /** How far the envelope has the gain (0..1). */
  external(): number {
    return this.ext;
  }

  /** Forget the material (a seek, a new show) and start from `gainDb`. Never a blast: clamped. */
  reset(gainDb: number = this.gainDb): void {
    this.mom.fill(0);
    this.momPos = 0;
    this.blockAcc = 0;
    this.blockHops = 0;
    this.active.fill(0);
    this.activeN = 0;
    this.activePos = 0;
    this.hopAcc = 0;
    this.hopCount = 0;
    this.learned = 0;
    this.lastBlockActive = false;
    this.gainDb = this.targetDb = clamp(gainDb);
    this.lastGain = Math.pow(10, this.gainDb / 20);
    for (const d of this.delay) d.fill(0);
    this.comp.reset();
    this.lim.reset();
  }

  /** Keep the measured history, change only the gain (a seek within the same show). */
  forgetHistory(): void {
    const g = this.gainDb;
    this.reset(g);
  }

  state(): LevelerState {
    return this.cur;
  }

  private activeLufs(): number {
    if (!this.activeN) return -Infinity;
    let s = 0;
    for (let i = 0; i < this.activeN; i++) s += this.active[i];
    return lufs(s / this.activeN);
  }

  /** The last `n` active blocks only (the newest talk). */
  private recentLufs(n: number): number {
    if (this.activeN < n) return -Infinity;
    let s = 0;
    for (let k = 1; k <= n; k++) s += this.active[(this.activePos - k + this.active.length) % this.active.length];
    return lufs(s / n);
  }

  /**
   * The slow path's estimate. The 3 s power mean, unless the newest second of
   * talk sits LEVEL_AGC.talkerChangeDb away from it: then someone else is talking
   * (the caller handed back to a quiet guest) and the newest second is the
   * estimate. A power mean is ruled by its loudest blocks, so after a loud
   * caller it held the gain down for most of 3 s, and the guest's first
   * sentences went by quiet.
   */
  private slowEstimate(La: number): number {
    const Lr = this.recentLufs(TALKER_CHANGE_BLOCKS);
    if (Lr > -Infinity && Math.abs(Lr - La) > LEVEL_AGC.talkerChangeDb) return Lr;
    return La;
  }

  /** One control step, every HOP_MS, on the detector (undelayed) side. */
  private control(hopMs: number): void {
    this.mom[this.momPos] = hopMs;
    this.momPos = (this.momPos + 1) % this.mom.length;
    let m = 0;
    for (let i = 0; i < this.mom.length; i++) m += this.mom[i];
    const Lm = lufs(m / this.mom.length);

    this.blockAcc += hopMs;
    if (++this.blockHops === BLOCK_MS / HOP_MS) {
      const bms = this.blockAcc / this.blockHops;
      this.blockAcc = 0;
      this.blockHops = 0;
      const Lb = lufs(bms);
      const La = this.activeLufs();
      this.lastBlockActive = Lb > LEVEL_AGC.gateAbs && (La === -Infinity || Lb > La - LEVEL_AGC.gateBelow);
      if (this.lastBlockActive) {
        this.active[this.activePos] = bms;
        this.activePos = (this.activePos + 1) % this.active.length;
        if (this.activeN < this.active.length) this.activeN++;
        this.learned += BLOCK_MS / 1000;
      }
    }
    const La = this.activeLufs();
    // Frozen in a pause: when the momentary loudness is quiet, or as soon as
    // the latest 100 ms block is (the momentary window still holds the last
    // words for 400 ms, and the gain kept climbing into the gap).
    this.frozen = !this.lastBlockActive || !(Lm > LEVEL_AGC.gateAbs && (La === -Infinity || Lm > La - LEVEL_AGC.gateBelow));
    const dt = HOP_MS / 1000;
    if (!this.frozen && La > -Infinity) {
      const slow = TARGET_LUFS - this.slowEstimate(La);
      const fast = TARGET_LUFS + LEVEL_AGC.momentaryHeadroom - Lm;
      this.targetDb = clamp(Math.min(slow, fast));
      const diff = this.targetDb - this.gainDb;
      // Acquisition: until 3 s of speech has been heard the estimate is
      // rough, and the start gain was a guess; let it rise faster then.
      const riseTau = this.learned < 3 ? 0.8 : LEVEL_AGC.riseTau;
      const riseCap = this.learned < 3 ? 8 : LEVEL_AGC.riseCap;
      let step = diff > 0 ? diff * (1 - Math.exp(-dt / riseTau)) : diff * (1 - Math.exp(-dt / LEVEL_AGC.fallTau));
      step = diff > 0 ? Math.min(step, riseCap * dt) : Math.max(step, -LEVEL_AGC.fallCap * dt);
      this.gainDb = clamp(this.gainDb + step);
    }
    this.cur = { gainDb: this.gainDb, targetDb: this.targetDb, frozen: this.frozen, activeLufs: La, momentaryLufs: Lm };
  }

  /** Measure only: the detector and the control loop, no audio touched. */
  measure(ch: Float32Array[], len: number): void {
    const [l, r] = ch;
    const kL = this.kw[0];
    const kR = this.kw[1];
    let i = 0;
    while (i < len) {
      const n = Math.min(len - i, this.hop - this.hopCount);
      let acc = 0;
      for (let j = i; j < i + n; j++) {
        const a = kL[1].tick(kL[0].tick(l[j]));
        const b = kR[1].tick(kR[0].tick(r[j]));
        acc += a * a + b * b;
      }
      this.hopAcc += acc;
      this.hopCount += n;
      i += n;
      if (this.hopCount >= this.hop) {
        this.control(this.hopAcc / this.hopCount);
        this.hopAcc = 0;
        this.hopCount = 0;
      }
    }
  }

  /**
   * Process two channels in place. `amount` 0..1 blends the AGC gain in
   * (0 = unity, for a ramp on enable/disable); the compressor and limiter
   * always run so the stage's latency and ceiling never change.
   */
  process(ch: Float32Array[], len: number, amount = 1): void {
    const [l, r] = ch;
    const kL = this.kw[0];
    const kR = this.kw[1];
    // External (envelope) handover: held for extDelay, then ramped per block.
    const e0 = this.ext;
    if (this.extDelay > 0) this.extDelay = Math.max(0, this.extDelay - len);
    else if (this.extWant && this.ext < 1) this.ext = Math.min(1, this.ext + this.extStep * len);
    else if (!this.extWant && this.ext > 0) this.ext = Math.max(0, this.ext - this.extStep * len);
    const e1 = this.ext;
    const agcShare = 1 - Math.max(e0, e1);
    let i = 0;
    while (i < len) {
      const n = Math.min(len - i, this.hop - this.hopCount);
      // Detector side: K-weighted energy of the incoming (undelayed) audio.
      let acc = 0;
      for (let j = i; j < i + n; j++) {
        const a = kL[1].tick(kL[0].tick(l[j]));
        const b = kR[1].tick(kR[0].tick(r[j]));
        acc += a * a + b * b;
      }
      this.hopAcc += acc;
      this.hopCount += n;
      // Audio side: delay by the lookahead, the gain smoothed per sample
      // (a one-pole on the linear gain), so a control step never zippers.
      const target = Math.pow(10, (this.gainDb * amount * agcShare) / 20);
      const a = this.smooth;
      let g = this.lastGain;
      for (let j = i; j < i + n; j++) {
        g += (target - g) * a;
        const rd = (this.dpos + 1) % this.dlen; // oldest sample: exactly `look` behind
        this.delay[0][this.dpos] = l[j];
        this.delay[1][this.dpos] = r[j];
        l[j] = this.delay[0][rd] * g;
        r[j] = this.delay[1][rd] * g;
        this.dpos = rd;
      }
      this.lastGain = g;
      i += n;
      if (this.hopCount >= this.hop) {
        this.control(this.hopAcc / this.hopCount);
        this.hopAcc = 0;
        this.hopCount = 0;
      }
    }
    if (e0 === 0 && e1 === 0) this.comp.process(ch, len);
    else if (e0 < 1 || e1 < 1) {
      // Crossfade the compressor out (or in) across the handover.
      if (this.pre[0].length < len) this.pre = [new Float32Array(len), new Float32Array(len)];
      this.pre[0].set(l.subarray(0, len));
      this.pre[1].set(r.subarray(0, len));
      this.comp.process(ch, len);
      for (let j = 0; j < len; j++) {
        const m = e0 + ((e1 - e0) * (j + 1)) / len;
        l[j] += m * (this.pre[0][j] - l[j]);
        r[j] += m * (this.pre[1][j] - r[j]);
      }
    }
    this.lim.process(ch, len);
  }
}

function clamp(db: number): number {
  return Math.max(-MAX_CUT, Math.min(MAX_BOOST, db));
}
