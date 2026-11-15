import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";
import { Chain } from "../src/audio/dsp/chain";

/**
 * The built worklet (public/audio/dsp-worklet.js) in a real browser's audio
 * engine: an OfflineAudioContext renders a programme through it, and the
 * result must match the same Chain run in Node, sample for sample (to float
 * rounding). This is what proves the bundle loads and runs where listeners
 * hear it: Chromium on desktop and Android, and WebKit (desktop Safari; iOS
 * itself never routes, docs/audio-processing/README.md) with E2E_WEBKIT=1.
 *
 * It needs no app server: the page and the worklet are answered from a
 * routed origin. Run it with any E2E_BASE_URL, e.g.
 *   E2E_BASE_URL=https://dsp.test npx playwright test e2e/dsp-render.spec.ts
 */

const FS = 48000;
const SECONDS = 6;
const ORIGIN = "https://dsp.test";
const WORKLET = readFileSync(join(__dirname, "../public/audio/dsp-worklet.js"), "utf8");

/** A loud and a quiet talker in turn, a hiss floor and 60 Hz hum: everything both switches touch. */
function programme(): Float32Array {
  let s = 12345;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const n = FS * SECONDS;
  const x = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp = 0.7 * lp + 0.3 * r();
    const talk = Math.sin((Math.PI * (i % 12000)) / 12000) ** 2;
    const level = Math.floor(i / (2 * FS)) % 2 === 0 ? 0.5 : 0.08;
    x[i] = lp * talk * level + 0.003 * r() + 0.004 * Math.sin((2 * Math.PI * 60 * i) / FS);
  }
  return x;
}

function inNode(x: Float32Array, opts: { level: boolean; cleanup: boolean }): Float32Array {
  const chain = new Chain(FS, { ...opts, startGainDb: 2 });
  const out = new Float32Array(x.length);
  const b = [new Float32Array(128), new Float32Array(128)];
  for (let i = 0; i < x.length; i += 128) {
    b[0].set(x.subarray(i, i + 128));
    b[1].set(x.subarray(i, i + 128));
    chain.process(b, 128);
    out.set(b[0], i);
  }
  return out;
}

for (const opts of [
  { level: true, cleanup: true },
  { level: true, cleanup: false },
  { level: false, cleanup: false },
]) {
  test(`the worklet renders what the Node chain does (level ${opts.level}, cleanup ${opts.cleanup})`, async ({ page }) => {
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/dsp-worklet.js") return route.fulfill({ body: WORKLET, contentType: "text/javascript" });
      return route.fulfill({ body: "<!doctype html><title>dsp</title>", contentType: "text/html" });
    });
    await page.goto(`${ORIGIN}/`);
    const x = programme();
    const got: number[] = await page.evaluate(
      async ({ input, fs, opts }) => {
        const ctx = new OfflineAudioContext(2, input.length, fs);
        // As a Blob: Chromium's worklet fetches bypass Playwright's routing.
        // (The app loads it by URL; e2e/dsp-player.spec.ts covers that path.)
        const code = await (await fetch("/dsp-worklet.js")).text();
        const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        await ctx.audioWorklet.addModule(url);
        const buf = ctx.createBuffer(2, input.length, fs);
        buf.getChannelData(0).set(input);
        buf.getChannelData(1).set(input);
        const src = new AudioBufferSourceNode(ctx, { buffer: buf });
        const node = new AudioWorkletNode(ctx, "hd-dsp", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: "explicit",
          processorOptions: { ...opts, startGainDb: 2 },
        });
        src.connect(node).connect(ctx.destination);
        src.start(0);
        const out = await ctx.startRendering();
        return Array.from(out.getChannelData(0));
      },
      { input: Array.from(x), fs: FS, opts },
    );
    const want = inNode(x, opts);
    expect(got.length).toBe(want.length);
    let maxDiff = 0;
    let energy = 0;
    for (let i = 0; i < want.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(got[i] - want[i]));
      energy += got[i] * got[i];
    }
    // Not silence, and the same audio: the engines' Math.exp/log/pow may
    // differ in the last bits, nothing more.
    expect(energy / want.length).toBeGreaterThan(1e-5);
    expect(maxDiff).toBeLessThan(1e-4);
  });
}

/**
 * The CPU budget: both switches on, stereo, 48 kHz, on a CPU throttled 4x
 * (Chromium's DevTools throttle). The throttle reaches the main thread only,
 * not the audio thread (measured: an offline render took the same time at 1x
 * and 4x), so the built processor is run on the main thread here, its
 * process() called block by block exactly as the audio thread would. Its
 * time over the audio's length is the share of a 4x-slower core it needs.
 * "Well inside" is under a quarter of the core. The worst single block is
 * reported, not asserted: the throttle works by suspending the thread in
 * slices, so one block can absorb a whole slice.
 */
test("both switches fit well inside the budget at 4x CPU throttle", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "CPU throttling is a Chromium DevTools feature");
  await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ body: "<!doctype html><title>dsp</title>", contentType: "text/html" }));
  await page.goto(`${ORIGIN}/`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.DSP_THROTTLE ?? 4) });
  const r = await page.evaluate(
    ({ code, fs, seconds }) => {
      const g = globalThis as unknown as Record<string, unknown>;
      g.sampleRate = fs;
      g.AudioWorkletProcessor = class {
        port = { postMessage() {}, onmessage: null };
      };
      let P: (new (o: unknown) => { process: (i: Float32Array[][], o: Float32Array[][]) => boolean }) | null = null;
      g.registerProcessor = (_n: string, cls: typeof P) => {
        P = cls;
      };
      new Function(code)();
      const proc = new P!({ processorOptions: { level: true, cleanup: true, startGainDb: 2 } });
      const blocks = (fs * seconds) / 128;
      const inL = new Float32Array(128);
      const inR = new Float32Array(128);
      const out = [new Float32Array(128), new Float32Array(128)];
      let worst = 0;
      let busy = 0;
      for (let b = 0; b < blocks; b++) {
        for (let i = 0; i < 128; i++) {
          const v = (Math.random() * 2 - 1) * 0.2;
          inL[i] = v;
          inR[i] = 0.9 * v + 0.01 * Math.random();
        }
        const t = performance.now();
        proc.process([[inL, inR]], [out]);
        const d = performance.now() - t;
        busy += d;
        if (b > 375 && d > worst) worst = d;
      }
      return { share: busy / 1000 / seconds, worstMs: worst };
    },
    { code: WORKLET, fs: 48000, seconds: 20 },
  );
  const msg = `${(r.share * 100).toFixed(1)}% of a 4x-throttled core, worst block ${r.worstMs.toFixed(2)} ms of 2.67 (stereo, 48 kHz, both on)`;
  testInfo.annotations.push({ type: "cpu", description: msg });
  console.log(`dsp cpu: ${msg}`);
  expect(r.share).toBeLessThan(0.25);
});
