#!/usr/bin/env node
/**
 * Two-pass Level, the server half (docs/audio-processing/README.md,
 * "Two-pass Level"): one ffmpeg ebur128 pass per episode gives momentary
 * loudness every 100 ms; `gainEnvelope` (src/lib/audio/level-envelope.ts)
 * turns it into the gain curve the browser applies; it is stored as int8 in
 * `level_envelopes`. Metadata only: the audio is streamed through ffmpeg and
 * never written anywhere.
 *
 * Order: the shows on the station today and tomorrow (Pacific) first, then by
 * community plays, then everything else. A show already done at
 * ENVELOPE_VERSION is skipped; a failed one waits 2^tries hours (at most a
 * week) before it is tried again.
 *
 * Where the bytes come from, as for the pre-air walk: a repaired show's
 * mirror copy (what plays), a pin from the mirror's disk, else archive.org,
 * one file at a time, read at most HD_ENVELOPE_RATE bytes a second (1 MB/s),
 * with a pause between files.
 *
 * Each episode runs in its own child inside the box-wide `heavy` slot
 * (`heavy -- node level-envelopes.mjs --one <fileHash>`), so other projects'
 * builds take turns with it between episodes. The unit holds the whole run
 * to CPUQuota=10%, Nice=19, idle IO (the 10% rule).
 *
 *   node scripts/level-envelopes.mjs [--budget-min 50] [--limit N] [--dry-run]
 *   node scripts/level-envelopes.mjs --one <fileHash>        # one episode, no heavy
 *   node scripts/level-envelopes.mjs --status                # counts, JSON
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archiveUrls, loadItems } from "./archive-items.mjs";
import { communityKey } from "./verify-live-day.mjs";
import { ENVELOPE_VERSION, encodeEnvelope, levelEnvelope } from "../src/lib/audio/level-envelope.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "HighDesert-level/1 (+https://highdesert.space)";
const STALL_MS = 60_000;
const RATE = Number(process.env.HD_ENVELOPE_RATE || 1_000_000);
const ARCHIVE_GAP_MS = 3_000;
/**
 * Out of the heavy slot between items, so other projects' queued jobs get a
 * turn: flock is not first come, first served, and a loop that retakes the
 * slot at once starved a waiting vitest for 40 minutes (2026-11-16).
 */
export const YIELD_MS = 15_000;
const MAX_BACKOFF_H = 24 * 7;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** Pacific calendar day of `now`, plus `add` days, YYYY-MM-DD. */
export function pacificDay(now = Date.now(), add = 0) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
  const d = new Date(`${fmt.format(new Date(now))}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

/**
 * The momentary loudness series from ffmpeg's ebur128 frame log: one value
 * per 100 ms, the window [t - 0.4, t]. Lines before the first full window
 * (t < 0.4) are dropped, so frame i covers [0.1 i, 0.1 i + 0.4], centred at
 * ENVELOPE_OFFSET_SEC + 0.1 i as the envelope expects. Also the integrated
 * loudness from the summary, or null.
 */
export function parseEbur128(text) {
  const L = [];
  let lufs = null;
  const re = /\bt:\s*([0-9.]+)\s+TARGET:\s*-?[0-9.]+\s+LUFS\s+M:\s*(-?[0-9.]+|-?inf|nan)/i;
  let summary = false;
  for (const line of text.split("\n")) {
    if (/Summary:/.test(line)) summary = true;
    if (summary) {
      const m = /^\s*I:\s*(-?[0-9.]+)\s+LUFS/.exec(line);
      if (m) lufs = Number(m[1]);
      continue;
    }
    const m = re.exec(line);
    if (!m) continue;
    if (Number(m[1]) < 0.35) continue; // ffmpeg prints a window's end as 0.0999792, 0.199979, ...
    const v = Number(m[2]);
    L.push(Number.isFinite(v) ? v : -120.7);
  }
  return { L, lufs };
}

/**
 * The order of work: today's and tomorrow's station first (their frozen
 * slots, else the dates' own shows), then by plays, then the rest by
 * fileHash. `done` is skipped; `waiting` (backing off) too. Pure.
 * @param {{ catalog: any[], plays: Map<string, number>, done: Set<string>, waiting?: Set<string>, station?: string[] }} o
 */
export function workOrder({ catalog, plays, done, waiting = new Set(), station = [] }) {
  const rows = catalog.filter((r) => r.fileHash);
  const byHash = new Map(rows.map((r) => [r.fileHash, r]));
  const ranked = [...rows]
    .map((r) => ({ r, n: plays.get(communityKey(r)) ?? 0 }))
    .sort((a, b) => b.n - a.n || (a.r.fileHash < b.r.fileHash ? -1 : 1));
  const order = [...station.map((h) => byHash.get(h)), ...ranked.filter((x) => x.n > 0).map((x) => x.r), ...ranked.filter((x) => x.n === 0).map((x) => x.r)];
  const seen = new Set();
  const out = [];
  for (const r of order) {
    if (!r || seen.has(r.fileHash)) continue;
    seen.add(r.fileHash);
    if (done.has(r.fileHash) || waiting.has(r.fileHash)) continue;
    out.push(r);
  }
  return out;
}

/** The shows on the station on these Pacific days: frozen slots, else the dates' own shows. */
export function stationHashes(days, frozenByDay, catalog) {
  const out = [];
  for (const day of days) {
    const program = frozenByDay.get(day);
    if (program?.slots?.length) {
      for (const s of program.slots) if (s.fileHash) out.push(s.fileHash);
      for (const h of program.ranking?.slice(0, 20) ?? []) out.push(h);
    } else {
      const md = day.slice(5);
      for (const r of catalog) if (r.airDate?.slice(5) === md) out.push(r.fileHash);
    }
  }
  return out;
}

/** Hours to wait after `tries` failures. */
export function backoffHours(tries) {
  return Math.min(MAX_BACKOFF_H, 2 ** Math.max(0, tries));
}

function sourceFor(row, stateDir, repaired, items) {
  if (repaired.has(row.fileHash)) return { kind: "repaired", path: path.join(stateDir, "repaired", row.fileHash) };
  const pin = path.join(stateDir, "pins", row.fileHash);
  if (existsSync(pin)) return { kind: "pin", path: pin };
  return { kind: "archive", urls: archiveUrls(row, items) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ffmpeg's ebur128 over a file, or over bytes written to its stdin by `feed`. */
function ebur128(input, feed) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-nostats", "-v", "verbose", "-i", input, "-map", "0:a:0", "-af", "ebur128=framelog=verbose:dualmono=true", "-f", "null", "-"], {
      stdio: [feed ? "pipe" : "ignore", "ignore", "pipe"],
    });
    let err = "";
    ff.stderr.setEncoding("utf8");
    ff.stderr.on("data", (d) => (err += d));
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))));
    if (feed) {
      ff.stdin.on("error", () => {});
      feed(ff.stdin).then(
        () => ff.stdin.end(),
        (e) => {
          ff.kill("SIGKILL");
          reject(e);
        },
      );
    }
  });
}

/** Stream one URL into `sink` at no more than RATE bytes a second. */
async function throttledFetch(url, sink) {
  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(), STALL_MS);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const t0 = Date.now();
    let bytes = 0;
    for await (const chunk of res.body) {
      clearTimeout(timer);
      timer = setTimeout(() => ac.abort(), STALL_MS);
      bytes += chunk.length;
      if (!sink.write(Buffer.from(chunk))) await new Promise((r) => sink.once("drain", r));
      const ahead = (bytes / RATE) * 1000 - (Date.now() - t0);
      if (ahead > 0) await sleep(ahead);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** One episode: measure, compute, store. Throws on failure (the parent records it). */
export async function runOne(row, { stateDir, repaired, items, pool, dry = false }) {
  const src = sourceFor(row, stateDir, repaired, items);
  let text;
  if (src.path) text = await ebur128(src.path);
  else {
    let last;
    for (const url of src.urls) {
      try {
        text = await ebur128("pipe:0", (stdin) => throttledFetch(url, stdin));
        break;
      } catch (e) {
        last = e;
      }
    }
    if (!text) throw last ?? new Error("no URL");
  }
  const { L, lufs } = parseEbur128(text);
  if (L.length < 100) throw new Error(`only ${L.length} loudness frames`);
  const q = encodeEnvelope(levelEnvelope(L));
  if (!dry) {
    await pool.query(
      `INSERT INTO level_envelopes (file_hash, version, frames, data, lufs, source, error, tries, measured_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, 0, now())
       ON CONFLICT (file_hash) DO UPDATE SET version = EXCLUDED.version, frames = EXCLUDED.frames, data = EXCLUDED.data,
         lufs = EXCLUDED.lufs, source = EXCLUDED.source, error = NULL, tries = 0, measured_at = now()`,
      [row.fileHash, ENVELOPE_VERSION, q.length, Buffer.from(q.buffer, q.byteOffset, q.length), lufs, src.kind],
    );
  }
  return { frames: q.length, lufs, from: src.kind };
}

async function recordFailure(pool, fileHash, error) {
  await pool.query(
    `INSERT INTO level_envelopes (file_hash, version, frames, data, error, tries, measured_at)
     VALUES ($1, $2, 0, NULL, $3, 1, now())
     ON CONFLICT (file_hash) DO UPDATE SET error = EXCLUDED.error, tries = level_envelopes.tries + 1, measured_at = now()`,
    [fileHash, ENVELOPE_VERSION, String(error).slice(0, 300)],
  );
}

function runChild(fileHash) {
  return new Promise((resolve) => {
    const child = spawn("heavy", ["--label", "hd-level-envelope", "--", process.execPath, "--no-warnings", fileURLToPath(import.meta.url), "--one", fileHash], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    });
    child.on("error", (e) => resolve({ code: 1, error: String(e) }));
    child.on("close", (code) => resolve({ code }));
  });
}

async function main() {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const stateDir = arg("--state", "/var/lib/highdesert-mirror");
  const catalog = JSON.parse(readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8"));
  const repaired = new Set(JSON.parse(readFileSync(path.join(ROOT, "src/data/repaired-episodes.json"), "utf8")).map((e) => e.fileHash));
  const items = loadItems();
  const dry = process.argv.includes("--dry-run");
  try {
    const one = arg("--one", null);
    if (one) {
      const row = catalog.find((r) => r.fileHash === one);
      if (!row) throw new Error(`not in the catalog: ${one}`);
      const t0 = Date.now();
      try {
        const r = await runOne(row, { stateDir, repaired, items, pool, dry });
        console.error(`[level-envelopes] ${row.airDate} ok: ${r.frames} frames, ${r.lufs} LUFS, from ${r.from}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      } catch (e) {
        console.error(`[level-envelopes] ${row.airDate} failed: ${e?.message ?? e}`);
        if (!dry) await recordFailure(pool, row.fileHash, e?.message ?? e);
        process.exitCode = 2;
      }
      return;
    }
    const { rows } = await pool.query(`SELECT file_hash, version, data IS NOT NULL AS ok, tries, extract(epoch FROM now() - measured_at) / 3600 AS age_h FROM level_envelopes`);
    const done = new Set(rows.filter((r) => r.ok && r.version === ENVELOPE_VERSION).map((r) => r.file_hash));
    const waiting = new Set(rows.filter((r) => !(r.ok && r.version === ENVELOPE_VERSION) && r.tries > 0 && Number(r.age_h) < backoffHours(r.tries)).map((r) => r.file_hash));
    if (process.argv.includes("--status")) {
      console.log(JSON.stringify({ catalog: catalog.length, done: done.size, waiting: waiting.size, failed: rows.filter((r) => !r.ok).length }));
      return;
    }
    const days = [pacificDay(Date.now(), 0), pacificDay(Date.now(), 1)];
    const frozen = new Map((await pool.query(`SELECT day::text AS day, program FROM live_days WHERE day = ANY($1::date[])`, [days])).rows.map((r) => [r.day, r.program]));
    const plays = new Map((await pool.query("SELECT episode_id, plays FROM episode_plays")).rows.map((r) => [r.episode_id, Number(r.plays)]));
    const todo = workOrder({ catalog, plays, done, waiting, station: stationHashes(days, frozen, catalog) });
    const budgetMs = Number(arg("--budget-min", "50")) * 60_000;
    const limit = Number(arg("--limit", "Infinity"));
    const started = Date.now();
    let ok = 0;
    let failed = 0;
    for (const row of todo) {
      if (Date.now() - started > budgetMs || ok + failed >= limit) break;
      const fromArchive = !repaired.has(row.fileHash) && !existsSync(path.join(stateDir, "pins", row.fileHash));
      const r = dry ? { code: 0 } : await runChild(row.fileHash);
      if (r.code === 0) ok++;
      else failed++;
      await sleep(Math.max(YIELD_MS, fromArchive ? ARCHIVE_GAP_MS : 0));
    }
    const status = { at: new Date().toISOString(), version: ENVELOPE_VERSION, done: done.size + ok, ok, failed, left: todo.length - ok - failed, catalog: catalog.length };
    console.log(JSON.stringify(status));
    const out = process.env.HD_ENVELOPE_STATUS;
    if (out && !dry) {
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(status, null, 2) + "\n");
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[level-envelopes] ${err?.stack ?? err}`);
    process.exit(1);
  });
}
