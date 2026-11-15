/**
 * The archive survey: 60 s at three points in ~150 episodes, chosen across
 * every year and series, measured by src/audio/dsp/metrics.ts.
 *
 *   systemd-run --scope -p CPUQuota=30% nice -n 19 ionice -c3 \
 *     node scripts/audio/measure-archive.ts <out.csv> [count]
 *
 * Gentle by construction: one request at a time, at least 3 s between
 * requests to archive.org, and the CPU held down by the scope's quota.
 * Resumable: rows already in <out.csv> are skipped.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { measure, type Measure } from "../../src/audio/dsp/metrics.ts";
import { decode, probe, sleep } from "./lib/decode.ts";

interface Row {
  fileHash: string;
  title: string;
  airDate: string;
  showType: string;
  sourceUrl: string;
  duration: number;
}

const out = process.argv[2];
const COUNT = Number(process.argv[3] ?? 150);
if (!out) throw new Error("usage: measure-archive.ts <out.csv> [count]");

const catalog: Row[] = JSON.parse(readFileSync(new URL("../../public/seed/library.json", import.meta.url), "utf8")).filter((e: Row) => e.sourceUrl);

/** A stable pseudo-random order: FNV-1a of the fileHash. */
function h(s: string): number {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return x;
}

/** Proportional allocation over (year, series), at least one from each, then the remainder by size. */
function choose(n: number): Row[] {
  const strata = new Map<string, Row[]>();
  for (const e of catalog) {
    const k = `${(e.airDate ?? "????").slice(0, 4)} ${e.showType}`;
    if (!strata.has(k)) strata.set(k, []);
    strata.get(k)!.push(e);
  }
  for (const v of strata.values()) v.sort((a, b) => h(a.fileHash) - h(b.fileHash));
  const quota = new Map<string, number>();
  for (const [k, v] of strata) quota.set(k, Math.max(1, Math.floor((n * v.length) / catalog.length)));
  let total = [...quota.values()].reduce((a, b) => a + b, 0);
  const bySize = [...strata.entries()].sort((a, b) => b[1].length - a[1].length);
  for (let i = 0; total < n; i = (i + 1) % bySize.length) {
    const [k, v] = bySize[i];
    if (quota.get(k)! < v.length) {
      quota.set(k, quota.get(k)! + 1);
      total++;
    }
  }
  return [...strata.entries()].flatMap(([k, v]) => v.slice(0, quota.get(k)!));
}

const POINTS = [0.12, 0.47, 0.82];
const SEG = 60;

const MEASURE_KEYS: (keyof Measure)[] = ["seconds", "channels", "lufs", "lra", "swing", "maxStep1s", "truePeakDb", "samplePeakDb", "noiseFloorDb", "medianDb", "deadAir", "hissDb", "voiceBandDb", "cutoffHz", "hum50", "hum60", "humLines", "humLevelDb", "clipFrac", "sideDb"];
const HEAD = ["fileHash", "airDate", "showType", "title", "point", "startSec", "srcCodec", "srcRate", "srcChannels", "srcKbps", ...MEASURE_KEYS, "error"];

const csvCell = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : "";
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One CSV line into cells (quoted cells may hold commas and doubled quotes). */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

if (!existsSync(out)) writeFileSync(out, HEAD.join(",") + "\n");
const done = new Set(
  readFileSync(out, "utf8")
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map(parseCsvLine)
    .filter((c) => c[4] !== "" && !c[c.length - 1])
    .map((c) => `${c[0]}|${c[4]}`),
);

const picks = choose(COUNT);
console.log(`${picks.length} episodes, ${picks.length * POINTS.length} segments`);
let lastRequest = 0;
const politely = async () => {
  const wait = lastRequest + 3000 - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
};

for (const [i, e] of picks.entries()) {
  if (POINTS.every((p) => done.has(`${e.fileHash}|${p}`))) continue;
  let pr;
  try {
    await politely();
    pr = await probe(e.sourceUrl);
  } catch (err) {
    appendFileSync(out, [e.fileHash, e.airDate, e.showType, e.title, "", "", "", "", "", "", ...MEASURE_KEYS.map(() => ""), `probe: ${String(err).slice(0, 120)}`].map(csvCell).join(",") + "\n");
    continue;
  }
  const dur = pr.duration > 600 ? pr.duration : e.duration;
  for (const p of POINTS) {
    if (done.has(`${e.fileHash}|${p}`)) continue;
    const start = Math.max(0, Math.round(dur * p));
    let cells: unknown[];
    try {
      await politely();
      const clip = await decode(e.sourceUrl, start, SEG, pr.channels);
      if (clip.ch[0].length < clip.fs * 20) throw new Error(`only ${(clip.ch[0].length / clip.fs).toFixed(1)} s decoded`);
      const m = measure(clip);
      cells = [e.fileHash, e.airDate, e.showType, e.title, p, start, pr.codec, pr.sampleRate, pr.channels, Math.round(pr.bitRate / 1000), ...MEASURE_KEYS.map((k) => m[k]), ""];
    } catch (err) {
      cells = [e.fileHash, e.airDate, e.showType, e.title, p, start, pr.codec, pr.sampleRate, pr.channels, Math.round(pr.bitRate / 1000), ...MEASURE_KEYS.map(() => ""), String(err).slice(0, 160)];
    }
    appendFileSync(out, cells.map(csvCell).join(",") + "\n");
  }
  console.log(`${i + 1}/${picks.length} ${e.airDate} ${e.showType}`);
}
console.log("done");
