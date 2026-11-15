/**
 * The AudioWorklet processor: the Chain (Clean up, then Level), run on the
 * audio thread in 128-sample blocks. Built into public/audio/dsp-worklet.js
 * by scripts/audio/build-worklet.mjs (a test fails when that file is stale).
 *
 * Messages in (port):
 *   { type: "set", level, cleanup }           the listener's switches
 *   { type: "duck" }                           a seek or a new source is coming
 *   { type: "unduck", newShow, startGainDb }   it has arrived
 * Messages out:
 *   { type: "ready", latency }                 once, at construction
 *   { type: "status", blocks, inPeak, idle, ...ChainStatus }  every ~250 ms
 *
 * Both switches off: once the last fade has finished the chain is a pure
 * delay, and this copies its input through that delay and nothing else.
 */
import { Chain } from "./chain.ts";

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

export const PROCESSOR_NAME = "hd-dsp";

interface Opts {
  processorOptions?: { level?: boolean; cleanup?: boolean; startGainDb?: number };
}

class DspProcessor extends AudioWorkletProcessor {
  private chain: Chain;
  private buf = [new Float32Array(128), new Float32Array(128)];
  private blocks = 0;
  private inPeak = 0;
  private statusEvery: number;

  constructor(options: Opts) {
    super(options);
    const o = options?.processorOptions ?? {};
    this.chain = new Chain(sampleRate, { level: !!o.level, cleanup: !!o.cleanup, startGainDb: o.startGainDb ?? 0 });
    this.statusEvery = Math.max(1, Math.round((0.25 * sampleRate) / 128));
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m?.type === "set") {
        this.chain.setLevel(!!m.level);
        this.chain.setCleanup(!!m.cleanup);
      } else if (m?.type === "duck") this.chain.duck();
      else if (m?.type === "unduck") this.chain.unduck({ newShow: !!m.newShow, startGainDb: typeof m.startGainDb === "number" ? m.startGainDb : undefined });
    };
    this.port.postMessage({ type: "ready", latency: this.chain.latency });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const out = outputs[0];
    const n = out[0]?.length ?? 128;
    if (this.buf[0].length < n) this.buf = [new Float32Array(n), new Float32Array(n)];
    const [l, r] = this.buf;
    if (!input || input.length === 0) {
      l.fill(0, 0, n);
      r.fill(0, 0, n);
    } else {
      l.set(input[0].subarray(0, n));
      r.set((input[1] ?? input[0]).subarray(0, n));
    }
    let pk = this.inPeak;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(l[i]);
      if (a > pk) pk = a;
    }
    this.inPeak = pk;
    this.chain.process(this.buf, n);
    out[0].set(l.subarray(0, n));
    if (out[1]) out[1].set(r.subarray(0, n));
    if (++this.blocks % this.statusEvery === 0) {
      this.port.postMessage({ type: "status", blocks: this.blocks, inPeak: this.inPeak, idle: this.chain.idle(), ...this.chain.status() });
      this.inPeak = 0;
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, DspProcessor);
