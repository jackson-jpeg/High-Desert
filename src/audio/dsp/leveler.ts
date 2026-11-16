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
export const LEVEL_AGC = { riseTau: 1.0, riseCap: 6, fallTau: 0.3, fallCap: 30, momentaryHeadroom: 5, gateAbs: -60, gateBelow: 22, talkerChangeDb: 4, maxBoost: 12, activeBlocks: 30, talkerBlocks: 10, lookaheadMs: 200, onset: false, onsetRiseCap: 20, onsetRiseTau: 0.15, onsetBackMs: 1500, onsetGapHops: 8, onsetGateBelow: 18, onsetForward: false, onsetForwardHops: 20, onsetForwardStop: false, onsetWindowMs: Infinity, onsetDriftCap: 2 };
export const LOOKAHEAD_MS = 200;
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
  private active = new Float64Array(LEVEL_AGC.activeBlocks);
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
   * Onset mode: per-hop history (mean square, active) from onsetBackMs behind
   * what is heard up to the detector's front, so the gain can be judged on
   * the audio as heard and steered by the phrase coming up.
   */
  private hist: Float64Array;
  private histAct: Uint8Array;
  private histPos = 0;
  private histN = 0;
  private lookHops: number;
  /** Onset mode: hops since what is heard became talk after a pause (Infinity in a pause). */
  private sinceOnset = Infinity;
  private heardWasActive = false;
  private pauseHops = 0;
  private sinceChange = Infinity;

  constructor(fs: number, initialGainDb = 0) {
    this.fs = fs;
    this.kw = [0, 1].map(() => kWeighting(fs).map((c) => new Biquad(c)));
    this.hop = Math.round((HOP_MS / 1000) * fs);
    this.look = Math.round((LEVEL_AGC.lookaheadMs / 1000) * fs);
    this.dlen = this.look + 1;
    this.delay = [new Float32Array(this.dlen), new Float32Array(this.dlen)];
    this.gainDb = this.targetDb = clamp(initialGainDb);
    this.lastGain = Math.pow(10, this.gainDb / 20);
    this.comp = new Compressor({ fs, ...LEVEL_COMP });
    this.smooth = 1 - Math.exp(-1 / (GAIN_SMOOTH_S * fs));
    this.lim = new Limiter({ fs, channels: 2, ceilingDb: CEILING_DBTP, lookaheadMs: 5, releaseMs: 80 });
    this.latency = this.look + this.lim.latency;
    this.lookHops = Math.round(LEVEL_AGC.lookaheadMs / HOP_MS);
    const H = this.lookHops + Math.max(Math.round(LEVEL_AGC.onsetBackMs / HOP_MS), 120) + 20;
    this.hist = new Float64Array(H);
    this.histAct = new Uint8Array(H);
    this.cur = { gainDb: this.gainDb, targetDb: this.gainDb, frozen: false, activeLufs: -Infinity, momentaryLufs: -Infinity };
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
    this.hist.fill(0);
    this.histAct.fill(0);
    this.histPos = 0;
    this.histN = 0;
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
    const Lr = this.recentLufs(LEVEL_AGC.talkerBlocks);
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
    if (LEVEL_AGC.onset) {
      this.controlOnset(hopMs, La, Lm);
      return;
    }
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

  /** The k-th hop back from the detector's front (0 = newest). */
  private histAt(k: number): number {
    return this.hist[(this.histPos - 1 - k + this.hist.length * 2) % this.hist.length];
  }
  private histActAt(k: number): number {
    return this.histAct[(this.histPos - 1 - k + this.hist.length * 2) % this.hist.length];
  }

  /**
   * Onset mode. The engineer's way: the fader moves when someone starts
   * talking, set for what they are about to say, and never in the silence
   * before them. "Talking" is judged on the audio as heard (lookHops behind
   * the detector); the level is the power mean of the talk coming up (the
   * next lookahead), or with the last onsetBackMs when too little is coming.
   * A hot caller still cuts at once from the detector (the fast path).
   */
  private controlOnset(hopMs: number, La: number, Lm: number): void {
    const hopL = lufs(hopMs);
    const act = hopL > LEVEL_AGC.gateAbs && (La === -Infinity || hopL > La - LEVEL_AGC.onsetGateBelow) ? 1 : 0;
    this.hist[this.histPos] = hopMs;
    this.histAct[this.histPos] = act;
    this.histPos = (this.histPos + 1) % this.hist.length;
    if (this.histN < this.hist.length) this.histN++;
    const look = Math.min(this.lookHops, this.histN - 1);
    // Heard now: the 100 ms (4 hops) ending at what is playing, and its 400 ms momentary.
    let heardAct = 0;
    let heardMs = 0;
    let heardN = 0;
    for (let k = look; k < Math.min(this.histN, look + 16); k++) {
      if (k < look + 4) heardAct += this.histActAt(k);
      heardMs += this.histAt(k);
      heardN++;
    }
    const Lh = lufs(heardMs / Math.max(1, heardN));
    const heardTalk = heardAct >= 4;
    // A talker change is an onset too, pause or not (hiss can fill every
    // gap): the last second heard this far under the two seconds before it.
    let changed = false;
    if (heardTalk && this.histN > look + 120 && this.sinceChange > 40) {
      let a = 0, an = 0, b = 0, bn = 0;
      for (let k = look; k < look + 40; k++) if (this.histActAt(k)) { a += this.histAt(k); an++; }
      for (let k = look + 40; k < look + 120; k++) if (this.histActAt(k)) { b += this.histAt(k); bn++; }
      if (an >= 20 && bn >= 40 && lufs(a / an) < lufs(b / bn) - LEVEL_AGC.talkerChangeDb) changed = true;
    }
    this.sinceChange = changed ? 0 : this.sinceChange + 1;
    if (heardTalk && ((!this.heardWasActive && this.pauseHops >= LEVEL_AGC.onsetGapHops) || changed)) this.sinceOnset = 0;
    else if (heardTalk) this.sinceOnset++;
    this.pauseHops = heardTalk ? 0 : this.pauseHops + 1;
    this.heardWasActive = heardTalk;
    this.frozen = heardAct < 4 || !(Lh > LEVEL_AGC.gateAbs && (La === -Infinity || Lh > La - LEVEL_AGC.onsetGateBelow));
    // The phrase being heard: its active run, gaps under onsetGapHops
    // bridged, back to where it began (at most onsetBackMs) and forward to
    // where it ends or the lookahead runs out. Never the next phrase: the
    // gain set for the next talker belongs at their onset, not at the tail
    // of this one.
    let ph = 0;
    let phN = 0;
    const G = LEVEL_AGC.onsetGapHops;
    for (let k = look, gap = 0; k >= 0 && gap <= G; k--) {
      if (this.histActAt(k)) {
        ph += this.histAt(k);
        phN++;
        gap = 0;
      } else gap++;
    }
    const backEnd = Math.min(this.histN, look + 1 + Math.round(LEVEL_AGC.onsetBackMs / HOP_MS));
    for (let k = look + 1, gap = 0; k < backEnd && gap <= G; k++) {
      if (this.histActAt(k)) {
        ph += this.histAt(k);
        phN++;
        gap = 0;
      } else gap++;
    }
    let est = -Infinity;
    if (LEVEL_AGC.onsetForward) {
      // Forward window: the talk coming up in the lookahead when there is
      // enough of it, else with what was heard in the last onsetBackMs.
      // It stops at the first pause of onsetGapHops (with onsetForwardStop):
      // the next phrase's level belongs at its own onset.
      let fwd = 0;
      let fwdN = 0;
      const stop = LEVEL_AGC.onsetForwardStop;
      for (let k = look, gap = 0; k >= 0 && (!stop || gap <= G); k--) {
        if (this.histActAt(k)) {
          fwd += this.histAt(k);
          fwdN++;
          gap = 0;
        } else gap++;
      }
      if (stop && fwdN < LEVEL_AGC.onsetForwardHops && phN >= 8) est = lufs(ph / phN);
      else if (fwdN >= LEVEL_AGC.onsetForwardHops) est = lufs(fwd / fwdN);
      else {
        let all = fwd;
        let allN = fwdN;
        const back = Math.min(this.histN, look + 1 + Math.round(LEVEL_AGC.onsetBackMs / HOP_MS));
        for (let k = look + 1; k < back; k++)
          if (this.histActAt(k)) {
            all += this.histAt(k);
            allN++;
          }
        if (allN >= 8) est = lufs(all / allN);
        else if (La > -Infinity) est = La;
      }
    } else if (phN >= 8) est = lufs(ph / phN);
    else if (La > -Infinity) est = La;
    const dt = HOP_MS / 1000;
    // The hot-caller cut, judged where it will be heard: the loudest 400 ms
    // momentary from what is playing to 200 ms ahead of it (the plain AGC's
    // own lookahead). From the detector's front it cut a lookahead early and
    // recovered while the caller was still being heard.
    let Lf = -Infinity;
    for (let k = Math.max(0, look - 8); k <= look; k++) {
      let m = 0;
      let mN = 0;
      for (let j = k; j < Math.min(this.histN, k + 16); j++) {
        m += this.histAt(j);
        mN++;
      }
      if (mN) Lf = Math.max(Lf, lufs(m / mN));
    }
    const fast = TARGET_LUFS + LEVEL_AGC.momentaryHeadroom - Lf;
    if (est > -Infinity) {
      this.targetDb = clamp(Math.min(TARGET_LUFS - est, fast));
      const diff = this.targetDb - this.gainDb;
      if (diff < 0) {
        // Down: at once for a hot caller (even in the pause before them), else with the talk.
        if (fast < this.gainDb || !this.frozen) this.gainDb = clamp(this.gainDb + Math.max(diff * (1 - Math.exp(-dt / LEVEL_AGC.fallTau)), -LEVEL_AGC.fallCap * dt));
      } else if (!this.frozen) {
        // Up only where a phrase starts (the first onsetWindowMs of talk
        // after a pause), else a slow drift: rising on a phrase's soft last
        // words carries the gain into the pause after it.
        const atOnset = this.sinceOnset * HOP_MS < LEVEL_AGC.onsetWindowMs;
        const cap = atOnset ? LEVEL_AGC.onsetRiseCap : LEVEL_AGC.onsetDriftCap;
        const step = Math.min(diff * (1 - Math.exp(-dt / LEVEL_AGC.onsetRiseTau)), cap * dt);
        this.gainDb = clamp(this.gainDb + step);
      }
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
      const target = Math.pow(10, (this.gainDb * amount) / 20);
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
    this.comp.process(ch, len);
    this.lim.process(ch, len);
  }
}

function clamp(db: number): number {
  return Math.max(-MAX_CUT, Math.min(LEVEL_AGC.maxBoost, db));
}
