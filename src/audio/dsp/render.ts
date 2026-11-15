/**
 * Offline rendering through the same Chain the AudioWorklet runs, in
 * 128-sample blocks as Web Audio delivers them. For the A/B clips, the
 * before/after table and the target tests.
 *
 * A one-channel clip is up-mixed to two identical channels first, as Web
 * Audio's speaker up-mix does before the worklet sees it. The chain's
 * latency is removed, so the output lines up with the input sample for
 * sample. `preRollSec` of the clip's start is processed but cut from the
 * output: a minute from the middle of a show is heard with the AGC already
 * settled on the show, which is how a listener meets it.
 */
import { Chain } from "./chain.ts";
import type { Clip } from "./metrics.ts";

export interface RenderOpts {
  level: boolean;
  cleanup: boolean;
  startGainDb?: number;
  preRollSec?: number;
  /** Called once per 25 ms with the chain's status (for gain traces). */
  onStatus?: (t: number, s: ReturnType<Chain["status"]>) => void;
}

export function render(c: Clip, o: RenderOpts): Clip {
  const src = c.ch.length === 1 ? [c.ch[0], c.ch[0]] : c.ch;
  const len = src[0].length;
  const chain = new Chain(c.fs, { level: o.level, cleanup: o.cleanup, startGainDb: o.startGainDb ?? 0 });
  const L = chain.latency;
  const out = [new Float32Array(len + L), new Float32Array(len + L)];
  const B = 128;
  const blk = [new Float32Array(B), new Float32Array(B)];
  const statusEvery = Math.round(0.025 * c.fs);
  let nextStatus = 0;
  for (let i = 0; i < len + L; i += B) {
    const n = Math.min(B, len + L - i);
    for (let ch = 0; ch < 2; ch++) {
      for (let j = 0; j < n; j++) blk[ch][j] = i + j < len ? src[ch][i + j] : 0;
    }
    chain.process(blk, n);
    out[0].set(blk[0].subarray(0, n), i);
    out[1].set(blk[1].subarray(0, n), i);
    if (o.onStatus && i >= nextStatus) {
      o.onStatus((i - L) / c.fs, chain.status());
      nextStatus += statusEvery;
    }
  }
  const pre = Math.round((o.preRollSec ?? 0) * c.fs);
  return { fs: c.fs, ch: [out[0].slice(L + pre, L + len), out[1].slice(L + pre, L + len)] };
}

/** The clip without its pre-roll, as two channels (the "original" to compare against). */
export function original(c: Clip, preRollSec = 0): Clip {
  const pre = Math.round(preRollSec * c.fs);
  const src = c.ch.length === 1 ? [c.ch[0], c.ch[0]] : c.ch;
  return { fs: c.fs, ch: src.map((x) => x.slice(pre)) };
}
