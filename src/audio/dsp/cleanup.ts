/**
 * Clean up: rumble, hum and hiss, in that order.
 *
 *   high-pass   4th-order Butterworth at HPF_HZ: rumble, handling noise,
 *               the turntable and the tape transport. Voices start above it.
 *   hum         notches only when hum.ts finds mains hum (50 or 60 Hz and
 *               harmonics); otherwise nothing at all.
 *   hiss        the spectral gate (denoise.ts), eased off while music.ts
 *               hears music: a bumper keeps its cymbals.
 *
 * The output here is the *wet* signal, delayed by exactly `latency` samples.
 * The chain mixes it with the dry signal it delays by the same amount.
 *
 * Mono (or two identical channels) runs the gate, the costly part, on one
 * channel and copies it. When the channels first differ the gate goes linked
 * stereo (denoise.ts: one FFT for both, one gain for both), carrying on from
 * where it was: they were identical until then.
 */
import { Biquad, highPass } from "./biquad.ts";
import { DEFAULT_DENOISE, Denoiser, HOP, N } from "./denoise.ts";
import { HumRemover } from "./hum.ts";
import { MusicDetector } from "./music.ts";

export const HPF_HZ = 70;
/** How far the gate backs off at full music score (1 = all the way to dry). Applied to the score squared. */
export const MUSIC_EASE = 0.85;

export class Cleanup {
  readonly latency = N;
  readonly fs: number;
  private hpf: Biquad[][];
  readonly hum: HumRemover;
  private dn: Denoiser;
  readonly music: MusicDetector;
  private stereo = false;
  /** HPF+hum signal, delayed N, per channel: the gate's dry. */
  private aDelay: Float32Array[];
  private apos = 0;
  private gateMix = 1;
  private mono: Float32Array;
  private dryL = new Float32Array(128);
  private dryR = new Float32Array(128);

  constructor(fs: number) {
    this.fs = fs;
    // Butterworth 4th order = two sections, Q 0.5412 and 1.3066.
    this.hpf = [0, 1].map(() => [new Biquad(highPass(fs, HPF_HZ, 0.5412)), new Biquad(highPass(fs, HPF_HZ, 1.3066))]);
    this.hum = new HumRemover(fs, 2);
    this.dn = new Denoiser({ fs, ...DEFAULT_DENOISE });
    this.music = new MusicDetector(fs / HOP);
    this.dn.onFrame = (f) => this.music.push(f.power);
    this.aDelay = [new Float32Array(N), new Float32Array(N)];
    this.mono = new Float32Array(128);
  }

  /** A new show: forget everything learned. */
  resetAll(): void {
    for (const s of this.hpf) for (const b of s) b.reset();
    this.hum.reset();
    this.dn.resetNoise();
    this.music.reset();
    this.stereo = false;
    for (const a of this.aDelay) a.fill(0);
    this.gateMix = 1;
  }

  /** A seek: the signal jumps, but the show's hiss and hum are the same. */
  resetPosition(): void {
    for (const s of this.hpf) for (const b of s) b.reset();
    this.dn.reset();
    for (const a of this.aDelay) a.fill(0);
  }

  /** In place: two channels in, the wet signal (N samples later) out. */
  process(ch: Float32Array[], len: number): void {
    const [l, r] = ch;
    if (!this.stereo) {
      for (let i = 0; i < len; i++) {
        if (l[i] !== r[i]) {
          this.stereo = true;
          this.dn.goStereo();
          break;
        }
      }
    }
    for (let c = 0; c < 2; c++) {
      this.hpf[c][0].run(ch[c], 0, len);
      this.hpf[c][1].run(ch[c], 0, len);
    }
    if (this.mono.length < len) {
      this.mono = new Float32Array(len);
      this.dryL = new Float32Array(len);
      this.dryR = new Float32Array(len);
    }
    for (let i = 0; i < len; i++) this.mono[i] = 0.5 * (l[i] + r[i]);
    this.hum.musicNow = this.music.score > 0.5;
    this.hum.analyse(this.mono, len);
    this.hum.process(ch, len);

    // The gate's dry: the HPF+hum signal, delayed to line up with its output.
    const { dryL, dryR } = this;
    for (let i = 0; i < len; i++) {
      const p = this.apos;
      dryL[i] = this.aDelay[0][p];
      dryR[i] = this.aDelay[1][p];
      this.aDelay[0][p] = l[i];
      this.aDelay[1][p] = r[i];
      this.apos = (p + 1) % N;
    }
    if (this.stereo) this.dn.process(l, len, r);
    else {
      this.dn.process(l, len);
      r.set(l.subarray(0, len));
    }

    // Ease the gate off during music, smoothly across the block.
    const sc = this.music.score;
    const want = 1 - MUSIC_EASE * sc * sc;
    const m0 = this.gateMix;
    for (let i = 0; i < len; i++) {
      const m = m0 + ((want - m0) * (i + 1)) / len;
      l[i] = dryL[i] + m * (l[i] - dryL[i]);
      r[i] = dryR[i] + m * (r[i] - dryR[i]);
    }
    this.gateMix = want;
  }
}
