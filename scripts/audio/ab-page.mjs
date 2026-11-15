/**
 * The listening page and the before/after table, from an evaluation run:
 *
 *   node scripts/audio/ab-page.mjs <results.json> <clips.json> <outDir>
 *
 * results.json is evaluate.ts --json; clips.json the spec it ran (for each
 * clip's `why` and `title`); outDir already holds the MP3s evaluate.ts wrote
 * with --out (<name>-original|level|cleanup|both.mp3). Writes
 * outDir/index.html (one row per clip, four players, the numbers beside
 * them) and outDir/before-after.md (the same numbers as a table).
 */
import { readFileSync, writeFileSync } from "node:fs";

const [resFile, clipFile, outDir] = process.argv.slice(2);
if (!outDir) throw new Error("usage: ab-page.mjs <results.json> <clips.json> <outDir>");
const results = JSON.parse(readFileSync(resFile, "utf8"));
const clips = Object.fromEntries(JSON.parse(readFileSync(clipFile, "utf8")).map((c) => [c.name, c]));

const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function verdicts(r) {
  const fails = [...Object.entries(r.level.pass), ...Object.entries(r.cleanup.pass)].filter(([, v]) => !v).map(([k]) => k);
  return { pass: fails.length === 0, fails };
}

function swingCell(L) {
  return L.swingIn >= 3 ? `${f(L.swingIn)} → ${f(L.swingOut)} (×${f(L.swingRatio, 2)})` : `${f(L.swingIn)} → ${f(L.swingOut)} (already level)`;
}

const rows = results.map((r) => {
  const c = clips[r.name] ?? {};
  const L = r.level;
  const C = r.cleanup;
  const v = verdicts(r);
  return { r, c, L, C, v };
});

// before-after.md
const md = [
  "| clip | why | talker swing dB | true peak dBTP | LUFS | pause lift dB | floor dB | hiss dB | voice dB | hum (min drop) | music (max band) | verdict |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(({ r, c, L, C, v }) =>
    [
      r.name,
      c.why ?? Object.keys(r.kind ?? {}).filter((k) => r.kind[k]).join(", "),
      swingCell(L),
      `${f(L.truePeakIn)} → ${f(L.truePeakOut)}`,
      `${f(L.lufsIn)} → ${f(L.lufsOut)}`,
      f(L.maxPauseRise, 2),
      `${f(C.floorIn)} → ${f(C.floorOut)} (−${f(C.floorDrop)})${r.kind?.hissy ? " hissy" : ""}`,
      `−${f(C.hissDrop)}`,
      f(C.voiceBandDelta, 2),
      C.hum ? `−${f(C.hum.minDrop)}` : "",
      r.kind?.music ? f(C.musicBandMax, 2) : "",
      v.pass ? "pass" : `FAIL: ${v.fails.join(", ")}`,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
  ),
].join("\n");
writeFileSync(`${outDir}/before-after.md`, `# Before and after\n\n${md}\n`);

// index.html
const versions = [
  ["original", "Original"],
  ["level", "Level"],
  ["cleanup", "Clean up"],
  ["both", "Both"],
];
const cards = rows
  .map(({ r, c, L, C, v }) => {
    const players = versions
      .map(
        ([k, label]) => `<div class="v"><span>${label}</span><audio controls preload="none" src="${esc(`${r.name}-${k}.mp3`)}"></audio></div>`,
      )
      .join("");
    const facts = [
      ["Talker swing", swingCell(L)],
      ["True peak", `${f(L.truePeakIn)} → ${f(L.truePeakOut)} dBTP`],
      ["Loudness", `${f(L.lufsIn)} → ${f(L.lufsOut)} LUFS`],
      ["Noise floor", `${f(C.floorIn)} → ${f(C.floorOut)} dB`],
      ["Voice band", `${f(C.voiceBandDelta, 2)} dB`],
      ...(C.hum ? [["Hum", `lines down ${f(C.hum.minDrop)} dB or more`]] : []),
      ...(r.kind?.music ? [["Music bands", `within ${f(C.musicBandMax, 2)} dB`]] : []),
    ]
      .map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`)
      .join("");
    return `<section class="clip">
  <header><h2>${esc(r.name)}</h2><span class="tag ${v.pass ? "ok" : "bad"}">${v.pass ? "pass" : `fail: ${esc(v.fails.join(", "))}`}</span></header>
  <p class="why">${esc(c.why ?? "")}${c.title ? `. ${esc(c.title)}` : ""}</p>
  <div class="players">${players}</div>
  <dl>${facts}</dl>
</section>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Level and Clean up: listening test</title>
<style>
:root{--bg:#f6f5f2;--fg:#1d1d1b;--dim:#5f5d57;--card:#fff;--line:#e2e0da;--ok:#1d6b3a;--bad:#a12a1c}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--dim:#a5a39b;--card:#1f1f1d;--line:#34332f;--ok:#6fc28c;--bad:#ef8a7c}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;margin:0 0 4px}.lede{color:var(--dim);margin:0 0 24px}
.clip{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 16px}
.clip header{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}
h2{font-size:17px;margin:0}.tag{font-size:12px;padding:1px 8px;border-radius:99px;border:1px solid currentColor}
.ok{color:var(--ok)}.bad{color:var(--bad)}.why{color:var(--dim);margin:4px 0 12px}
.players{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px}
.v{display:flex;flex-direction:column;gap:2px}.v span{font-size:12px;color:var(--dim)}audio{width:100%}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;margin:12px 0 0;font-size:13px}dt{color:var(--dim)}dd{margin:0;font-variant-numeric:tabular-nums}
</style></head><body><main>
<h1>Level and Clean up: listening test</h1>
<p class="lede">Each clip is one minute of an archive.org show, rendered offline through the same code the browser runs. Original, Level alone, Clean up alone, and both. All four are encoded the same way (MP3, 128 kbps), so compare them with each other.</p>
${cards}
</main></body></html>
`;
writeFileSync(`${outDir}/index.html`, html);
console.log(`wrote ${outDir}/index.html and before-after.md (${rows.length} clips)`);
