/**
 * The test set, chosen from the archive survey (measure-archive.ts):
 *
 *   node scripts/audio/pick-test-set.ts <survey.csv> > candidates.json
 *
 * Badness of a segment is the sum of three z-scores over the survey: talker
 * level wandering (`swing`), how close the noise floor sits under the
 * programme (`medianDb - noiseFloorDb`, small is bad) and the hum level.
 * Out of that, one segment per episode:
 *   - worst 8, typical 4 (nearest the median badness), cleanest 2;
 *   - targeted: the biggest 1 s step (a hot caller beside a quiet guest),
 *     the most dead air, the hummiest (two or more lines), and hiss
 *     candidates: the highest hiss floor among full-band files (cutoff at
 *     least 7 kHz), whose spectrograms are then read by eye, because a
 *     music bed or continuous talk reads as "hiss" to the survey's
 *     measure (README, "Hiss is rarer than the survey says").
 * Bumper music is not in the survey's three points; those clips are cut
 * from the show openings by hand (README, "The test set").
 *
 * Output: evaluate.ts's clips.json shape, `src` the archive.org URL, 15 s
 * of pre-roll before the 60 s scored, plus `why` and the row's numbers.
 */
import { readFileSync } from "node:fs";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

type Row = Record<string, string> & { n: Record<string, number> };

const file = process.argv[2];
if (!file) throw new Error("usage: pick-test-set.ts <survey.csv>");
const [head, ...body] = parseCsv(readFileSync(file, "utf8"));
const seen = new Set<string>();
const rows: Row[] = [];
for (const cells of body) {
  const r = Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""])) as Row;
  if (r.error || !r.seconds) continue;
  const key = `${r.fileHash}|${r.point}`;
  if (seen.has(key)) continue;
  seen.add(key);
  r.n = Object.fromEntries(head.map((h) => [h, Number(r[h])]));
  rows.push(r);
}

const z = (get: (r: Row) => number) => {
  const v = rows.map(get);
  const m = v.reduce((a, x) => a + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length) || 1;
  return (r: Row) => (get(r) - m) / sd;
};
const zSwing = z((r) => r.n.swing);
const zSnr = z((r) => -(r.n.medianDb - r.n.noiseFloorDb));
const zHum = z((r) => (Number.isFinite(r.n.humLevelDb) ? r.n.humLevelDb : -90));
const bad = (r: Row) => zSwing(r) + zSnr(r) + zHum(r);

/** Episodes already used, so no episode appears twice. */
const used = new Set<string>();
function take(sorted: Row[], count: number, why: string) {
  const out: { r: Row; why: string }[] = [];
  for (const r of sorted) {
    if (out.length >= count) break;
    if (used.has(r.fileHash)) continue;
    used.add(r.fileHash);
    out.push({ r, why });
  }
  return out;
}

const byBad = [...rows].sort((a, b) => bad(b) - bad(a));
const median = bad(byBad[Math.floor(byBad.length / 2)]);
const picks = [
  ...take(byBad, 8, "worst"),
  ...take([...rows].sort((a, b) => bad(a) - bad(b)), 2, "cleanest"),
  ...take([...rows].sort((a, b) => Math.abs(bad(a) - median) - Math.abs(bad(b) - median)), 4, "typical"),
  ...take([...rows].sort((a, b) => b.n.maxStep1s - a.n.maxStep1s), 1, "caller-guest"),
  ...take([...rows].sort((a, b) => b.n.deadAir - a.n.deadAir), 1, "dead-air"),
  ...take(
    rows.filter((r) => r.n.humLines >= 2).sort((a, b) => b.n.humLevelDb - a.n.humLevelDb),
    1,
    "hummy",
  ),
  ...take(
    rows.filter((r) => r.n.cutoffHz >= 7000).sort((a, b) => b.n.hissDb - a.n.hissDb),
    6,
    "hiss-candidate",
  ),
];

function url(fileHash: string) {
  const m = /^archive:([^:]+):(.+)$/.exec(fileHash);
  if (!m) throw new Error(`not an archive key: ${fileHash}`);
  return `https://archive.org/download/${m[1]}/${encodeURIComponent(m[2])}`;
}

const PRE = 15;
console.log(
  JSON.stringify(
    picks.map(({ r, why }) => ({
      name: `${why}-${r.airDate}`,
      src: url(r.fileHash),
      start: Math.max(PRE, r.n.startSec),
      dur: 60,
      preRoll: PRE,
      kind: { hummy: why === "hummy" || r.n.humLines >= 2 },
      why,
      title: r.title,
      survey: {
        point: r.point,
        badness: Number(bad(r).toFixed(2)),
        swing: r.n.swing,
        maxStep1s: r.n.maxStep1s,
        snrDb: Number((r.n.medianDb - r.n.noiseFloorDb).toFixed(1)),
        hissDb: r.n.hissDb,
        cutoffHz: r.n.cutoffHz,
        humLines: r.n.humLines,
        humLevelDb: r.n.humLevelDb,
        deadAir: r.n.deadAir,
      },
    })),
    null,
    2,
  ),
);
console.error(`${rows.length} segments, ${picks.length} picked`);
