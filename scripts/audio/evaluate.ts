/**
 * Render test clips through the chain (original / Level / Clean up / both)
 * and score them against the targets (src/audio/dsp/targets.ts).
 *
 *   node scripts/audio/evaluate.ts <clips.json> [--out <dir>] [--json <file>]
 *
 * clips.json: [{ name, src, start?, dur?, preRoll?, kind: {hissy?, hummy?, music?} }]
 * `src` is a local file or a URL (decoded with ffmpeg; a URL is one Range read).
 * With --out, each version is written as <dir>/<name>-<version>.mp3.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { measure, type Clip } from "../../src/audio/dsp/metrics.ts";
import { original, render } from "../../src/audio/dsp/render.ts";
import { checkCleanup, checkLevel, type GainPoint } from "../../src/audio/dsp/targets.ts";
import { decode, encode, probe } from "./lib/decode.ts";

interface ClipSpec {
  name: string;
  src: string;
  start?: number;
  dur?: number;
  preRoll?: number;
  kind?: { hissy?: boolean; hummy?: boolean; music?: boolean };
}

const args = process.argv.slice(2);
const specFile = args[0];
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
if (!specFile) throw new Error("usage: evaluate.ts <clips.json> [--out dir] [--json file] [--only name]");
const specs: ClipSpec[] = JSON.parse(readFileSync(specFile, "utf8")).filter((s: ClipSpec) => !only || s.name.includes(only));
if (outDir) mkdirSync(outDir, { recursive: true });

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const results: unknown[] = [];

for (const s of specs) {
  const pre = s.preRoll ?? 0;
  const pr = await probe(s.src);
  const clip: Clip = await decode(s.src, Math.max(0, (s.start ?? 0) - pre), (s.dur ?? 60) + pre, pr.channels);
  const kind = s.kind ?? {};
  const t0 = performance.now();
  const trace: GainPoint[] = [];
  const lv = render(clip, {
    level: true,
    cleanup: false,
    preRollSec: pre,
    onStatus: (t, st) => {
      if (t >= pre) trace.push({ t: t - pre, gainDb: st.level.gainDb, frozen: st.level.frozen });
    },
  });
  const tLevel = performance.now() - t0;
  const t1 = performance.now();
  const cu = render(clip, { level: false, cleanup: true, preRollSec: pre });
  const tClean = performance.now() - t1;
  const both = render(clip, { level: true, cleanup: true, preRollSec: pre });
  const orig = original(clip, pre);
  const L = checkLevel(orig, lv, trace);
  const C = checkCleanup(orig, cu, kind);
  const mb = measure(both);
  const secs = orig.ch[0].length / orig.fs;
  const r = {
    name: s.name,
    kind,
    level: L,
    cleanup: C,
    both: { lufs: mb.lufs, truePeak: mb.truePeakDb, swing: mb.swing, floor: mb.noiseFloorDb },
    cpu: { levelPct: (100 * tLevel) / 1000 / (secs + pre), cleanupPct: (100 * tClean) / 1000 / (secs + pre) },
  };
  results.push(r);
  const pass = Object.values(L.pass).every(Boolean) && Object.values(C.pass).every(Boolean);
  console.log(
    `${pass ? "PASS" : "FAIL"} ${s.name.padEnd(28)}` +
      ` | Level talk ${f(L.swingIn)}->${f(L.swingOut)} (${f(L.swingRatio, 2)}) st ${f(L.stSwingIn)}->${f(L.stSwingOut)} TP ${f(L.truePeakOut)} rate +${f(L.maxRiseRate)}/-${f(L.maxFallRate)} pause +${f(L.maxPauseRise, 2)} LUFS ${f(L.lufsIn)}->${f(L.lufsOut)}` +
      ` | Clean floor ${f(C.floorIn)}->${f(C.floorOut)} (-${f(C.floorDrop)}) hiss -${f(C.hissDrop)} voice ${f(C.voiceBandDelta, 2)}` +
      (C.hum ? ` hum ${C.hum.family} min -${f(C.hum.minDrop)} [${C.hum.lines.map((l) => `${f(l.freq, 1)}:${f(l.dropDb, 0)}`).join(" ")}]` : "") +
      (kind.music ? ` music ${f(C.musicBandMax, 2)}` : "") +
      ` | cpu L ${f(r.cpu.levelPct)}% C ${f(r.cpu.cleanupPct)}%` +
      (pass ? "" : `  fails: ${[...Object.entries(L.pass), ...Object.entries(C.pass)].filter(([, v]) => !v).map(([k]) => k).join(",")}`),
  );
  if (outDir) {
    const mp3 = ["-codec:a", "libmp3lame", "-b:a", "128k"];
    await encode(orig, `${outDir}/${s.name}-original.mp3`, mp3);
    await encode(lv, `${outDir}/${s.name}-level.mp3`, mp3);
    await encode(cu, `${outDir}/${s.name}-cleanup.mp3`, mp3);
    await encode(both, `${outDir}/${s.name}-both.mp3`, mp3);
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
