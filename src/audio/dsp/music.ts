/**
 * Is this music? The bumpers (the songs in and out of every hour) are loved,
 * and a voice-tuned denoiser smears them, so Clean up eases off while this
 * says music.
 *
 * The feature is the spread of the signal's loudness over the last WINDOW_S:
 * the standard deviation of log energy in ~21 ms steps. Talk radio stops
 * between words and phrases, so its log energy swings widely; a song's
 * envelope barely moves. Calibrated on hand-labelled openings from four
 * decades of the archive (docs/audio-processing/README.md, "Music"):
 *
 *                      p10    p50    p90     (decades, 3 s windows)
 *   music              0.19   0.34   0.46
 *   speech             0.44   1.35   2.57
 *
 * A 3 s window caught 90 % of music windows and flagged 13 % of speech
 * windows. Two other features were tried and dropped: spectral
 * stationarity (0.99 for everything) and partial persistence at 47 Hz bins
 * (no separation; at 12 Hz bins it added 7 points of music detection for a
 * second large FFT per hop, too dear on an old phone).
 *
 * The score moves smoothly (attack ~0.7 s, release ~2 s). The caller squares
 * it before easing anything, so an unsure "maybe" barely changes the gate.
 */

export const WINDOW_S = 3;
/** One analysis step, about 21 ms of the caller's frames. */
const STEP_S = 0.021;
/** logsd at or under which a window is music; at or over SPEECH_SD, speech. */
export const MUSIC_SD = 0.35;
export const SPEECH_SD = 0.65;

export class MusicDetector {
  private framesPerStep: number;
  private acc = 0;
  private accN = 0;
  private log: Float64Array;
  private pos = 0;
  private n = 0;
  private up: number;
  private down: number;
  /** 0 (speech) .. 1 (music), smoothed. */
  score = 0;
  /** The last window's spread of log energy, for calibration. */
  sd = 0;

  constructor(frameRate: number) {
    this.framesPerStep = Math.max(1, Math.round(STEP_S * frameRate));
    const steps = Math.round(WINDOW_S / STEP_S);
    this.log = new Float64Array(steps);
    const stepRate = frameRate / this.framesPerStep;
    this.up = 1 - Math.exp(-1 / (0.7 * stepRate));
    this.down = 1 - Math.exp(-1 / (2 * stepRate));
  }

  reset(): void {
    this.acc = this.accN = 0;
    this.log.fill(0);
    this.pos = this.n = 0;
    this.score = 0;
  }

  /** One frame's power. */
  push(power: number): void {
    this.acc += power;
    if (++this.accN < this.framesPerStep) return;
    const e = this.acc;
    this.acc = this.accN = 0;
    const len = this.log.length;
    this.log[this.pos] = Math.log10(e + 1e-12);
    this.pos = (this.pos + 1) % len;
    if (this.n < len) {
      this.n++;
      return;
    }
    let m = 0;
    for (let i = 0; i < len; i++) m += this.log[i];
    m /= len;
    // A silent window (dead air) is neither: leave the score where it is.
    if (m < -9) return;
    let v = 0;
    for (let i = 0; i < len; i++) v += (this.log[i] - m) ** 2;
    this.sd = Math.sqrt(v / len);
    const want = Math.max(0, Math.min(1, (SPEECH_SD - this.sd) / (SPEECH_SD - MUSIC_SD)));
    this.score += (want - this.score) * (want > this.score ? this.up : this.down);
  }
}
