#!/usr/bin/env node
/**
 * Walks every MPEG frame of every catalog episode and records what it found:
 * the runtime, and each run of one stream configuration (sample rate, mono or
 * stereo). A file with more than one run changes configuration midstream,
 * which every Chromium engine refuses at the change ("Unsupported midstream
 * configuration change"): the 2001-11-26 Egyptian Cave file did that 43:59 in
 * (docs/broken-episodes.md). Nothing at the HTTP layer, and no 64 KB sample,
 * can see it: the whole file has to be walked.
 *
 *   node scripts/scan-catalog-audio.mjs --out <file.jsonl> [--limit N] [--concurrency N] [--pins DIR] [--catalog FILE]
 *
 * - A pinned episode is walked from the mirror's disk (no download); the rest
 *   stream from archive.org and are never saved.
 * - Resumable: an episode already in --out is skipped, so it runs in batches
 *   (--limit) and each batch can take its turn under `heavy`.
 * - `--concurrency N` walks at once (default 1), request starts at least 2 s
 *   apart. A stalled download (60 s without a byte) is an error
 *   row, retried by --retry-errors.
 *
 * Read-only. Run it niced, in the idle IO class.
 */
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream } from "node:fs";
import { createWalker, audioVerdict } from "./measure-duration.mjs";
import { archiveUrls, loadItems } from "./archive-items.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "HighDesert-audio-scan/1 (highdesert.space)";
const STALL_MS = 60_000;
const GAP_MS = 2_000;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** The rows already in the output, by fileHash (the last row for a hash wins). */
export function readDone(path) {
  const done = new Map();
  if (!existsSync(path)) return done;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      done.set(r.fileHash, r);
    } catch {
      /* a line cut by a kill: walked again */
    }
  }
  return done;
}

async function walkUrl(url, w) {
  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(), STALL_MS);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for await (const chunk of res.body) {
      clearTimeout(timer);
      timer = setTimeout(() => ac.abort(), STALL_MS);
      w.push(Buffer.from(chunk));
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * /download first, then the collection's own servers (data/archive-items.json):
 * on 2026-10-11 /download failed for most of the catalog while those served.
 * Each attempt walks from the first byte with a fresh walker.
 */
async function walk(row, pinsDir, items = loadItems()) {
  const pin = pinsDir && join(pinsDir, row.fileHash);
  if (pin && existsSync(pin)) {
    const w = createWalker();
    for await (const chunk of createReadStream(pin)) w.push(chunk);
    return { from: "pin", ...w.end() };
  }
  let last;
  for (const [i, u] of archiveUrls(row, items).entries()) {
    const w = createWalker();
    try {
      await walkUrl(u, w);
      return { from: i === 0 ? "archive" : "archive-direct", ...w.end() };
    } catch (err) {
      last = err;
    }
  }
  throw last ?? new Error("no URL");
}

async function main() {
  const out = arg("--out");
  if (!out) throw new Error("--out <file.jsonl> is required");
  const limit = Number(arg("--limit", "Infinity"));
  const pinsDir = arg("--pins", "/var/lib/highdesert-mirror/pins");
  const retryErrors = process.argv.includes("--retry-errors");
  const catalog = JSON.parse(readFileSync(arg("--catalog", join(ROOT, "public/seed/library.json")), "utf8"));
  const done = readDone(out);
  const todo = catalog.filter((r) => {
    const d = done.get(r.fileHash);
    return !d || (retryErrors && d.error);
  });
  console.error(`[scan] ${catalog.length} in the catalog, ${catalog.length - todo.length} done, ${todo.length} to walk${Number.isFinite(limit) ? `, this batch ${Math.min(limit, todo.length)}` : ""}`);

  // A pool of `--concurrency` walks (default 1): archive.org serves one
  // connection at well under 1 MB/s, so a catalog walk one file at a time is
  // most of a day. Request starts stay at least GAP_MS apart.
  const concurrency = Math.max(1, Number(arg("--concurrency", "1")));
  const batch = todo.slice(0, Number.isFinite(limit) ? limit : todo.length);
  let next = 0;
  let n = 0;
  let last = 0;
  async function worker() {
    for (;;) {
      const row = batch[next++];
      if (!row) return;
      const wait = last + GAP_MS - Date.now();
      last = Math.max(Date.now(), last + GAP_MS);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      let rec;
      try {
        const r = await walk(row, pinsDir);
        const v = audioVerdict(r, row.duration ?? 0);
        rec = { fileHash: row.fileHash, airDate: row.airDate, catalogSeconds: row.duration ?? null, ...r, ...v };
      } catch (err) {
        rec = { fileHash: row.fileHash, airDate: row.airDate, error: String(err?.message ?? err), ok: false, reason: "unreadable" };
      }
      rec.at = new Date().toISOString();
      appendFileSync(out, JSON.stringify(rec) + "\n");
      n++;
      console.error(`[scan] ${n} ${row.airDate} ${rec.ok ? "ok" : rec.reason}${rec.segments?.length > 1 ? ` (${rec.segments.length} segments)` : ""}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  // Exit 3 while anything is left, so a driving loop knows to run another batch.
  const remaining = todo.length - n;
  console.error(`[scan] batch done: ${n} walked, ${remaining} left`);
  process.exit(remaining > 0 ? 3 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
