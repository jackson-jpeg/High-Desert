#!/usr/bin/env node
/**
 * The station's pre-air check (2026-10-11): walks every MPEG frame of the
 * files that can air on the next Pacific day and records the verdict in
 * `audio_checks`, before that day is frozen. frozenDay()
 * (src/services/live/days.ts) then swaps any slot whose file failed for a fan
 * favorite that passed (`applyVerifySwap`), and the breaker picks only walked
 * files as replacements (src/services/live/breaker.ts).
 *
 * What can air on a day: every catalog episode with that month-day (the "on
 * this date" block), and the top fan favorites by community plays. The
 * frozen day's own slots and ranking too, when it is already frozen.
 *
 * A file's bytes do not change, so a file with a row is never walked again.
 * A repaired show (src/data/repaired-episodes.json) is judged by the copy the
 * mirror serves, which is what plays; a pinned one is read from the mirror's
 * disk; the rest stream from archive.org and are never saved.
 *
 *   node scripts/verify-live-day.mjs [--day YYYY-MM-DD] [--favorites 60] [--budget-min 90] [--dry-run]
 *   node scripts/verify-live-day.mjs --import <scan.jsonl>   # the catalog scan's rows
 *
 * Runs from highdesert-verify-live.timer: Nice=19, idle IO, CPUQuota=10%.
 * Writes its last run to $HD_VERIFY_STATUS for the digest.
 */
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWalker, audioVerdict } from "./measure-duration.mjs";
import { readDone } from "./scan-catalog-audio.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "HighDesert-preair/1 (highdesert.space)";
const STALL_MS = 60_000;
export const DEFAULT_FAVORITES = 60;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** The same key the stats tables use (src/lib/utils/community-key.ts). */
export function communityKey(row) {
  if (!row.archiveIdentifier) return null;
  return `${row.archiveIdentifier}--${row.fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)}`;
}

/** The Pacific calendar day after the one `now` falls in. */
export function nextPacificDay(now = Date.now()) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
  const today = fmt.format(new Date(now));
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Month-days that air on `day` (src/lib/live/schedule.ts `onThisDateKeys`: 29 Feb folds onto 28 Feb). */
export function monthDays(day) {
  const y = Number(day.slice(0, 4));
  const md = day.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return md === "02-28" && !leap ? [md, "02-29"] : [md];
}

/**
 * The files to walk for `day`, in order: the frozen day's slots, the
 * on-this-date block, then fan favorites by plays (and the frozen ranking).
 * Anything already checked is left out. Pure: the caller loads the inputs.
 */
export function candidatesFor(day, { catalog, plays, checked, frozen = null, favorites = DEFAULT_FAVORITES }) {
  // isAirable (src/lib/live/schedule.ts); a pulled row is not in the shipped catalog.
  const airable = catalog.filter((r) => r.fileHash && typeof r.duration === "number" && Number.isFinite(r.duration) && r.duration > 0);
  const byHash = new Map(airable.map((r) => [r.fileHash, r]));
  const mds = new Set(monthDays(day));
  // rankByPlays: most played first, ties by fileHash (zero plays included).
  const ranked = [...airable]
    .map((r) => ({ r, n: plays.get(communityKey(r)) ?? 0 }))
    .sort((a, b) => b.n - a.n || (a.r.fileHash < b.r.fileHash ? -1 : 1))
    .slice(0, favorites)
    .map((x) => x.r);
  const order = [
    ...(frozen?.slots ?? []).map((s) => byHash.get(s.fileHash)),
    ...airable.filter((r) => r.airDate && mds.has(r.airDate.slice(5))),
    ...ranked,
    ...(frozen?.ranking ?? []).slice(0, favorites).map((h) => byHash.get(h)),
  ];
  const seen = new Set();
  const out = [];
  for (const r of order) {
    if (!r || seen.has(r.fileHash) || checked.has(r.fileHash)) continue;
    seen.add(r.fileHash);
    out.push(r);
  }
  return out;
}

/** Where to read a file from: the repaired copy, a pin, or archive.org. */
export function sourceFor(row, { stateDir, repaired }) {
  if (repaired.has(row.fileHash)) return { kind: "repaired", path: path.join(stateDir, "repaired", row.fileHash) };
  const pin = path.join(stateDir, "pins", row.fileHash);
  if (existsSync(pin)) return { kind: "pin", path: pin };
  return { kind: "archive", url: row.sourceUrl || row.filePath };
}

async function walkSource(src) {
  const w = createWalker();
  if (src.path) {
    for await (const chunk of createReadStream(src.path)) w.push(chunk);
    return w.end();
  }
  const ac = new AbortController();
  let timer = setTimeout(() => ac.abort(), STALL_MS);
  try {
    const res = await fetch(src.url, { headers: { "user-agent": UA }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for await (const chunk of res.body) {
      clearTimeout(timer);
      timer = setTimeout(() => ac.abort(), STALL_MS);
      w.push(Buffer.from(chunk));
    }
  } finally {
    clearTimeout(timer);
  }
  return w.end();
}

/**
 * The verdict for one file. An unreadable file (archive.org down, a stall) is
 * no verdict at all: nothing is written, and it is walked again next night.
 */
export async function check(row, opts) {
  const src = sourceFor(row, opts);
  try {
    const r = await walkSource(src);
    // A repaired copy is judged on its own runtime, not the catalog's.
    const v = audioVerdict(r, src.kind === "repaired" ? 0 : (row.duration ?? 0));
    return { fileHash: row.fileHash, from: src.kind, ok: v.ok, reason: v.reason, seconds: r.seconds, segments: r.segments };
  } catch (err) {
    return { fileHash: row.fileHash, from: src.kind, error: String(err?.message ?? err) };
  }
}

/** The rows of a catalog scan (scripts/scan-catalog-audio.mjs) that carry a verdict. */
export function importable(scanRows, repaired) {
  return [...scanRows.values()].filter((r) => !r.error && r.reason !== "unreadable" && !repaired.has(r.fileHash));
}

async function upsert(pool, rows) {
  for (const r of rows) {
    await pool.query(
      `INSERT INTO audio_checks (file_hash, ok, reason, seconds, segments, checked_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, now())
       ON CONFLICT (file_hash) DO UPDATE SET ok = EXCLUDED.ok, reason = EXCLUDED.reason,
         seconds = EXCLUDED.seconds, segments = EXCLUDED.segments, checked_at = now()`,
      [r.fileHash, r.ok, r.reason ?? null, r.seconds ?? null, JSON.stringify(r.segments ?? [])],
    );
  }
}

async function main() {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const stateDir = arg("--state", "/var/lib/highdesert-mirror");
  const repaired = new Set(JSON.parse(readFileSync(path.join(ROOT, "src/data/repaired-episodes.json"), "utf8")).map((e) => e.fileHash));
  const dry = process.argv.includes("--dry-run");
  try {
    const scan = arg("--import");
    if (scan) {
      const rows = importable(readDone(scan), repaired);
      if (!dry) await upsert(pool, rows);
      console.log(JSON.stringify({ imported: rows.length, bad: rows.filter((r) => !r.ok).map((r) => `${r.fileHash} ${r.reason}`) }));
      return;
    }

    const day = arg("--day", nextPacificDay());
    const favorites = Number(arg("--favorites", String(DEFAULT_FAVORITES)));
    const budgetMs = Number(arg("--budget-min", "90")) * 60_000;
    const catalog = JSON.parse(readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8"));
    const plays = new Map(
      (await pool.query("SELECT episode_id, plays FROM episode_plays")).rows.map((r) => [r.episode_id, Number(r.plays)]),
    );
    const checked = new Set((await pool.query("SELECT file_hash FROM audio_checks")).rows.map((r) => r.file_hash));
    const frozen = (await pool.query("SELECT program FROM live_days WHERE day = $1::date", [day])).rows[0]?.program ?? null;
    const todo = candidatesFor(day, { catalog, plays, checked, frozen, favorites });

    const started = Date.now();
    const results = [];
    for (const row of todo) {
      if (Date.now() - started > budgetMs) break;
      const r = await check(row, { stateDir, repaired });
      results.push(r);
      console.error(`[verify-live] ${row.airDate} ${r.error ? `unreadable: ${r.error}` : r.ok ? "ok" : r.reason} (${r.from})`);
      if (!r.error && !dry) await upsert(pool, [r]);
    }
    const status = {
      at: new Date().toISOString(),
      day,
      frozen: !!frozen,
      candidates: todo.length,
      walked: results.length,
      bad: results.filter((r) => !r.error && !r.ok).map((r) => ({ fileHash: r.fileHash, reason: r.reason })),
      unreadable: results.filter((r) => r.error).length,
      left: todo.length - results.length,
    };
    console.log(JSON.stringify(status));
    const out = process.env.HD_VERIFY_STATUS;
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
    console.error(`[verify-live] ${err?.stack ?? err}`);
    process.exit(1);
  });
}
