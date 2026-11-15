/**
 * The whole processor: Clean up, then Level, at one constant latency.
 *
 *   input ─┬─ Clean up (wet) ─┐                      ┌─ Level ─┐
 *          └─ delay N ────────┴ mix(cleanupMix) ─┬───┤         ├ mix(levelMix) ─ duck ─ out
 *                                                └─ delay L ───┘
 *
 * Every switch is a ramp, and the latency never changes, so a toggle can
 * never click, pop or jump:
 *
 *   - A stage being switched on is *warmed* first: it runs, unheard, for its
 *     own latency (a cold gate or limiter would hand out silence for that
 *     long), and only then is it crossfaded in (CROSSFADE_MS).
 *   - Level's gain is then brought in over LEVEL_RAMP_MS, from unity, so its
 *     arrival is a gentle change of loudness, never a jump.
 *   - A stage switched off is crossfaded out, then stops running. With both
 *     off, this is a pure delay (and the host can take it out of the graph).
 *   - duck(): a seek or a new show. The output fades to silence over
 *     DUCK_MS and stays there until unduck() plus one full latency, so the
 *     old position's tail never plays after the jump; then it fades in.
 *
 * Level's measurement runs even while it is off, so switching it on starts
 * from the right gain for what is playing.
 */
import { Cleanup } from "./cleanup.ts";
import { Leveler, type LevelerState } from "./leveler.ts";

export const CROSSFADE_MS = 60;
export const LEVEL_RAMP_MS = 800;
export const DUCK_MS = 15;
export const UNDUCK_MS = 40;

class DelayLine {
  private buf: Float32Array[];
  private pos = 0;
  private len: number;
  constructor(len: number) {
    this.len = len;
    this.buf = [new Float32Array(Math.max(1, len)), new Float32Array(Math.max(1, len))];
  }
  /** Write `src`, read the same count `len` samples older into `dst`. */
  run(src: Float32Array[], dst: Float32Array[], n: number): void {
    if (this.len === 0) {
      dst[0].set(src[0].subarray(0, n));
      dst[1].set(src[1].subarray(0, n));
      return;
    }
    for (let i = 0; i < n; i++) {
      const p = this.pos;
      const a = this.buf[0][p];
      const b = this.buf[1][p];
      this.buf[0][p] = src[0][i];
      this.buf[1][p] = src[1][i];
      dst[0][i] = a;
      dst[1][i] = b;
      this.pos = (p + 1) % this.len;
    }
  }
  clear(): void {
    for (const b of this.buf) b.fill(0);
  }
}

/** One stage's switch: off, warming (running, unheard), fading, on. */
class Switch {
  want = false;
  running = false;
  mix = 0;
  private warm = 0;
  private warmLen: number;
  private step: number;
  constructor(warmLen: number, step: number) {
    this.warmLen = warmLen;
    this.step = step;
  }
  set(on: boolean): void {
    if (on && !this.want) {
      this.want = true;
      if (!this.running) {
        this.running = true;
        this.warm = this.warmLen;
      }
    } else if (!on) this.want = false;
  }
  /** The mix at the start of the block advance() just stepped (the end is `mix`). */
  m0 = 0;
  /** Advance by n samples (no allocation: read m0 and mix after). */
  advance(n: number): void {
    this.m0 = this.mix;
    if (this.want) {
      if (this.warm > 0) this.warm = Math.max(0, this.warm - n);
      else this.mix = Math.min(1, this.mix + this.step * n);
    } else {
      this.mix = Math.max(0, this.mix - this.step * n);
      if (this.mix === 0) this.running = false;
    }
  }
  /** Ready to be heard immediately (the first show of a page with it on). */
  snapOn(): void {
    this.want = this.running = true;
    this.warm = 0;
    this.mix = 1;
  }
}

export interface ChainStatus {
  level: LevelerState & { on: boolean; mix: number; compGrDb: number; limGainDb: number };
  cleanup: { on: boolean; mix: number; music: number; humFamily: 50 | 60 | null; humLines: number };
  ducked: boolean;
}

export class Chain {
  readonly fs: number;
  readonly latency: number;
  readonly cleanup: Cleanup;
  readonly level: Leveler;
  private cSw: Switch;
  private lSw: Switch;
  private dCleanup: DelayLine;
  private dLevel: DelayLine;
  private levelAmount = 0;
  private levelWant = false;
  private levelStep: number;
  private duckGain = 1;
  private duckTarget = 1;
  private duckHold = 0;
  private duckDown: number;
  private duckUp: number;
  private s: Float32Array[][];

  constructor(fs: number, opts: { level?: boolean; cleanup?: boolean; startGainDb?: number } = {}) {
    this.fs = fs;
    this.cleanup = new Cleanup(fs);
    this.level = new Leveler(fs, opts.startGainDb ?? 0);
    this.latency = this.cleanup.latency + this.level.latency;
    const step = 1 / ((CROSSFADE_MS / 1000) * fs);
    this.cSw = new Switch(this.cleanup.latency, step);
    this.lSw = new Switch(this.level.latency, step);
    this.dCleanup = new DelayLine(this.cleanup.latency);
    this.dLevel = new DelayLine(this.level.latency);
    this.levelStep = 1 / ((LEVEL_RAMP_MS / 1000) * fs);
    this.duckDown = 1 / ((DUCK_MS / 1000) * fs);
    this.duckUp = 1 / ((UNDUCK_MS / 1000) * fs);
    this.s = Array.from({ length: 3 }, () => [new Float32Array(128), new Float32Array(128)]);
    // At construction nothing has played: a stage asked for now is simply on.
    if (opts.cleanup) this.cSw.snapOn();
    if (opts.level) {
      this.levelWant = true;
      this.lSw.snapOn();
      this.levelAmount = 1;
    }
  }

  setLevel(on: boolean): void {
    this.levelWant = on;
    if (on) this.lSw.set(true);
  }
  setCleanup(on: boolean): void {
    this.cSw.set(on);
  }
  /** Both off and fully faded: nothing but delay lines are running. */
  idle(): boolean {
    return !this.cSw.running && !this.lSw.running && !this.cSw.want && !this.levelWant;
  }

  /** Fade out now, for a jump in the input (a seek, a new show). */
  duck(): void {
    this.duckTarget = 0;
    this.duckHold = Infinity;
  }
  /**
   * The jump has happened: once the old audio has drained (one full latency),
   * fade back in. `newShow` forgets what was learned; `startGainDb` is where
   * Level begins on it.
   */
  unduck(opts: { newShow?: boolean; startGainDb?: number } = {}): void {
    if (opts.newShow) {
      this.cleanup.resetAll();
      this.level.reset(opts.startGainDb ?? 0);
    } else {
      this.cleanup.resetPosition();
      this.level.forgetHistory();
    }
    this.dCleanup.clear();
    this.dLevel.clear();
    this.duckHold = this.latency;
  }

  status(): ChainStatus {
    const ls = this.level.state();
    const hum = this.cleanup.hum.status();
    return {
      level: { ...ls, on: this.levelWant, mix: this.lSw.mix, compGrDb: this.level.comp.gainReductionDb, limGainDb: 20 * Math.log10(this.level.lim.minGain) },
      cleanup: { on: this.cSw.want, mix: this.cSw.mix, music: this.cleanup.music.score, humFamily: hum.family, humLines: hum.lines.filter((l) => l.depth > 0.5).length },
      ducked: this.duckGain < 1,
    };
  }

  private scratch(n: number): void {
    if (this.s[0][0].length >= n) return;
    this.s = Array.from({ length: 3 }, () => [new Float32Array(n), new Float32Array(n)]);
  }

  /** Two channels in place, `n` samples. */
  process(ch: Float32Array[], n: number): void {
    this.scratch(n);
    const [dry, wet, tmp] = this.s;

    // ── Clean up ──
    this.dCleanup.run(ch, dry, n);
    this.cSw.advance(n);
    const c0 = this.cSw.m0;
    const c1 = this.cSw.mix;
    if (this.cSw.running) {
      wet[0].set(ch[0].subarray(0, n));
      wet[1].set(ch[1].subarray(0, n));
      this.cleanup.process(wet, n);
      for (let i = 0; i < n; i++) {
        const m = c0 + ((c1 - c0) * (i + 1)) / n;
        ch[0][i] = dry[0][i] + m * (wet[0][i] - dry[0][i]);
        ch[1][i] = dry[1][i] + m * (wet[1][i] - dry[1][i]);
      }
    } else {
      ch[0].set(dry[0].subarray(0, n));
      ch[1].set(dry[1].subarray(0, n));
    }

    // ── Level ──
    // Off: its gain goes back to unity first (LEVEL_RAMP_MS / 2), and only
    // then is the stage crossfaded out. On: warmed, crossfaded in at unity,
    // then its gain comes in over LEVEL_RAMP_MS.
    if (!this.levelWant && this.levelAmount === 0) this.lSw.set(false);
    this.dLevel.run(ch, dry, n);
    this.lSw.advance(n);
    const l0 = this.lSw.m0;
    const l1 = this.lSw.mix;
    if (this.lSw.running) {
      if (this.levelWant && this.lSw.mix === 1) this.levelAmount = Math.min(1, this.levelAmount + this.levelStep * n);
      else if (!this.levelWant) this.levelAmount = Math.max(0, this.levelAmount - 2 * this.levelStep * n);
      tmp[0].set(ch[0].subarray(0, n));
      tmp[1].set(ch[1].subarray(0, n));
      this.level.process(tmp, n, this.levelAmount);
      for (let i = 0; i < n; i++) {
        const m = l0 + ((l1 - l0) * (i + 1)) / n;
        ch[0][i] = dry[0][i] + m * (tmp[0][i] - dry[0][i]);
        ch[1][i] = dry[1][i] + m * (tmp[1][i] - dry[1][i]);
      }
    } else {
      // Keep measuring (cheap: K-weighting only), so switching on starts
      // from the right gain. Not with both switches off: then nothing but
      // the delay lines runs (bypass means bypass), and Level, switched on
      // later, acquires from its start gain like a new show.
      if (this.cSw.running) this.level.measure(ch, n);
      ch[0].set(dry[0].subarray(0, n));
      ch[1].set(dry[1].subarray(0, n));
    }

    // ── Duck ──
    if (this.duckTarget === 0 || this.duckGain < 1) {
      for (let i = 0; i < n; i++) {
        if (this.duckHold !== Infinity && this.duckHold > 0) this.duckHold--;
        else if (this.duckHold === 0) this.duckTarget = 1;
        this.duckGain = this.duckTarget < this.duckGain ? Math.max(0, this.duckGain - this.duckDown) : Math.min(1, this.duckGain + this.duckUp);
        ch[0][i] *= this.duckGain;
        ch[1][i] *= this.duckGain;
      }
      if (this.duckTarget === 1 && this.duckGain === 1) this.duckHold = 0;
    }
  }
}
