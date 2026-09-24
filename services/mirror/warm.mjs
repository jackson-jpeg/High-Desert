#!/usr/bin/env node
/**
 * Nightly warm cache (highdesert-mirror-warm.timer): pin the most-played
 * episodes of the last 90 days, up to MIRROR_PIN_MAX_GB, so an archive.org
 * outage finds them already here.
 *
 * - Skips itself while hypervisor steal is above MIRROR_WARM_MAX_STEAL (20%):
 *   the box has no cycles to spare then, and nothing here is urgent.
 * - Fetches by webseed — plain HTTP from archive.org — which only works while
 *   archive.org is healthy, i.e. exactly when this runs. A fetch that fails is
 *   skipped, not retried: tomorrow is another run.
 * - Every download is checked against the episode's torrent piece hashes
 *   before it is marked complete, so a pinned file is byte-for-byte the torrent
 *   and the gateway can seed it back.
 * - Never lets free space fall below MIRROR_DISK_FLOOR_GB.
 * - Writes `pins.json` atomically; the gateway re-reads it every minute.
 *   An episode that falls out of the top becomes an ordinary LRU entry.
 *
 * Reads plays straight from Postgres (DATABASE_URL, the app's env file) via
 * psql: one aggregate query over play_events, no session refs touched.
 */
import { readFile, writeFile, rename, mkdir, rm, statfs } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTorrent, verifyAgainst } from "./lib/torrent-file.mjs";
import { currentSteal } from "./lib/steal.mjs";
import { fileNameOf } from "./lib/gateway.mjs";

const execFileP = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const env = (k, d) => process.env[k] ?? d;
const GB = 1024 ** 3;

/** src/lib/utils/community-key.ts, restated. */
export function communityKeyOf(fileHash) {
  const m = /^archive:([^:]+):(.+)$/.exec(fileHash);
  if (!m) return null;
  const sanitized = m[2].replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  return `${m[1]}--${sanitized}`;
}

/**
 * Which episodes to pin: most plays first, whole files only, until the budget.
 * `plays` is [{episodeId (community key), plays}] in descending order.
 */
export function choosePins(plays, index, budgetBytes) {
  const byKey = new Map();
  for (const [fileHash, e] of Object.entries(index)) byKey.set(communityKeyOf(fileHash), { fileHash, ...e });
  const out = [];
  let used = 0;
  for (const { episodeId } of plays) {
    const e = byKey.get(episodeId);
    if (!e) continue;
    if (used + e.length > budgetBytes) continue; // a smaller one further down may still fit
    used += e.length;
    out.push(e);
  }
  return { pins: out, bytes: used };
}

async function topPlays() {
  const sql = `SELECT episode_id, count(*) FROM play_events
               WHERE played_at >= now() - interval '90 days'
               GROUP BY episode_id ORDER BY count(*) DESC, episode_id`;
  const { stdout } = await execFileP("psql", [process.env.DATABASE_URL, "-At", "-F", "\t", "-c", sql]);
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [episodeId, n] = l.split("\t");
      return { episodeId, plays: Number(n) };
    });
}

async function main() {
  const cacheDir = env("MIRROR_CACHE_DIR", "/var/cache/highdesert-mirror");
  const torrentDir = env("MIRROR_TORRENT_DIR", "/var/lib/highdesert-mirror/torrents");
  const index = JSON.parse(await readFile(env("MIRROR_INDEX", path.join(here, "episodes.json")), "utf8"));
  const budget = Number(env("MIRROR_PIN_MAX_GB", "15")) * GB;
  const floor = Number(env("MIRROR_DISK_FLOOR_GB", "10")) * GB;
  const maxSteal = Number(env("MIRROR_WARM_MAX_STEAL", "20"));
  const status = { at: new Date().toISOString(), outcome: "ok", pinned: 0, bytes: 0, fetched: 0, failed: 0 };
  const writeStatus = () => writeFile(path.join(cacheDir, "warm-status.json"), JSON.stringify(status) + "\n");
  await mkdir(path.join(cacheDir, "data"), { recursive: true });

  const steal = await currentSteal(30);
  if (steal !== null && steal > maxSteal) {
    Object.assign(status, { outcome: "skipped-steal", steal });
    await writeStatus();
    console.log(`[warm] steal ${steal.toFixed(1)}% > ${maxSteal}%: skipping tonight`);
    return;
  }

  const { pins, bytes } = choosePins(await topPlays(), index, budget);
  console.log(`[warm] ${pins.length} episodes, ${(bytes / GB).toFixed(1)} GB within ${budget / GB} GB`);

  const kept = [];
  for (const p of pins) {
    const dir = path.join(cacheDir, "data", p.infohash);
    const name = fileNameOf(p.fileHash);
    const target = path.join(dir, name);
    const marker = path.join(dir, ".complete");
    const torrent = parseTorrent(await readFile(path.join(torrentDir, `${p.infohash}.torrent`)));
    try {
      await readFile(marker);
      kept.push(p.infohash);
      continue; // already complete
    } catch {
      /* fetch it */
    }
    const fs = await statfs(cacheDir);
    if (fs.bavail * fs.bsize - p.length < floor) {
      console.log(`[warm] disk floor reached; stopping at ${kept.length}`);
      status.outcome = "stopped-at-floor";
      break;
    }
    const url = torrent.urlList[0];
    try {
      await mkdir(dir, { recursive: true });
      const res = await fetch(url, { headers: { "user-agent": "highdesert.space mirror-warm" } });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(`${target}.part`));
      await verifyAgainst(torrent, createReadStream(`${target}.part`));
      await rename(`${target}.part`, target);
      await writeFile(marker, "");
      kept.push(p.infohash);
      status.fetched++;
      console.log(`[warm] pinned ${name} (${(p.length / 1e6).toFixed(0)} MB)`);
    } catch (err) {
      status.failed++;
      await rm(`${target}.part`, { force: true });
      console.warn(`[warm] ${name}: ${err.message}`);
    }
  }

  const tmp = path.join(cacheDir, "pins.json.tmp");
  await writeFile(tmp, JSON.stringify(kept.sort()));
  await rename(tmp, path.join(cacheDir, "pins.json"));
  Object.assign(status, { pinned: kept.length, bytes: pins.filter((p) => kept.includes(p.infohash)).reduce((a, p) => a + p.length, 0) });
  await writeStatus();
  console.log(`[warm] ${kept.length} pinned, ${status.fetched} fetched, ${status.failed} failed`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[warm]", err);
    process.exit(1);
  });
}
