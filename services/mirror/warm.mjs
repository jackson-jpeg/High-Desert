#!/usr/bin/env node
/**
 * Nightly warm (highdesert-mirror-warm.timer): pin the most-played episodes of
 * the last 90 days, up to MIRROR_PIN_MAX_GB, so an archive.org outage finds
 * them already here. nginx serves whatever is in the pin directory; this job
 * is the only thing that writes to it. A plain HTTP download — there is no
 * torrent client any more (docs/torrent-mirror-feasibility.md, "Torrent client
 * removed") — checked against the episode's torrent piece hashes.
 *
 * - Skips itself while hypervisor steal is above MIRROR_WARM_MAX_STEAL (20%):
 *   the box has no cycles to spare then, and nothing here is urgent.
 * - Downloads from archive.org, which only works while archive.org is healthy,
 *   i.e. exactly when this runs. A fetch that fails is skipped, not retried:
 *   tomorrow is another run.
 * - Every download lands in `<stateDir>/tmp`, is verified piece by piece
 *   against the .torrent's SHA-1s, and only then renamed into
 *   `<stateDir>/pins/<fileHash>`. A file that fails verification is deleted,
 *   never pinned.
 * - Episodes that fell out of the top are unpinned first (an unpinned episode
 *   still plays through nginx's fill cache while archive.org is up).
 * - Never lets free space fall below MIRROR_DISK_FLOOR_GB.
 * - Rewrites `<stateDir>/manifest.json` atomically at the end.
 *
 * Reads plays straight from Postgres (DATABASE_URL, the app's env file) via
 * psql: one aggregate query over play_events, no session refs touched.
 */
import { readFile, writeFile, rename, mkdir, rm, stat, statfs, chmod, readdir } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTorrent, verifyAgainst } from "./lib/torrent-file.mjs";
import { currentSteal } from "./lib/steal.mjs";
import { layout, fileNameOf, isPinnableName, readPins, writeManifest } from "./lib/pins.mjs";

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

export function archiveUrlOf(fileHash) {
  const m = /^archive:([^:]+):(.+)$/.exec(fileHash);
  return m ? `https://archive.org/download/${m[1]}/${encodeURIComponent(m[2])}` : null;
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

async function sizeOf(p) {
  try {
    const s = await stat(p);
    return s.isFile() ? s.size : -1;
  } catch {
    return -1;
  }
}

/**
 * Download `url` to `part`, verify it against `torrent`, and rename it to
 * `target`. Throws — leaving nothing at `target` and no `part` behind — if the
 * download or the verification fails.
 */
export async function fetchVerified({ url, torrent, part, target, fetchImpl = fetch, timeoutMs = 30 * 60_000 }) {
  try {
    const res = await fetchImpl(url, {
      headers: { "user-agent": "highdesert.space mirror-warm (+https://highdesert.space)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part, { mode: 0o644 }));
    await verifyAgainst(torrent, createReadStream(part));
    await chmod(part, 0o644); // nginx (www-data) reads the pins
    await rename(part, target);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
}

/**
 * One warm run. Everything the outside world supplies is injectable, for
 * test/warm.test.mjs: `steal()` (percent or null), `plays()`, `fetchImpl`,
 * `freeBytes()`.
 */
export async function runWarm({
  stateDir,
  statusPath,
  torrentDir,
  index,
  budgetBytes,
  floorBytes,
  maxSteal,
  steal = () => currentSteal(30),
  plays = topPlays,
  fetchImpl = fetch,
  freeBytes = async () => {
    const s = await statfs(stateDir);
    return s.bavail * s.bsize;
  },
  log = (m) => console.log(`[warm] ${m}`),
}) {
  const dirs = layout(stateDir);
  const status = { at: new Date().toISOString(), outcome: "ok", pinned: 0, bytes: 0, fetched: 0, failed: 0, pruned: 0 };
  const writeStatus = () => writeFile(statusPath, JSON.stringify(status) + "\n");
  await mkdir(dirs.pins, { recursive: true, mode: 0o755 });
  await mkdir(dirs.tmp, { recursive: true, mode: 0o700 });

  const s = await steal();
  if (s !== null && s > maxSteal) {
    Object.assign(status, { outcome: "skipped-steal", steal: s });
    await writeStatus();
    log(`steal ${s.toFixed(1)}% > ${maxSteal}%: skipping tonight`);
    return status;
  }

  const { pins: chosen, bytes } = choosePins(await plays(), index, budgetBytes);
  log(`${chosen.length} episodes, ${(bytes / GB).toFixed(1)} GB within ${(budgetBytes / GB).toFixed(1)} GB`);

  // Unpin what fell out of the top — but never on an empty choice, which is a
  // database with no plays in it, not a verdict that nothing is worth keeping.
  if (chosen.length > 0) {
    const keep = new Set(chosen.map((p) => p.fileHash));
    for (const name of await readdir(dirs.pins)) {
      if (keep.has(name)) continue;
      await rm(path.join(dirs.pins, name), { force: true });
      status.pruned++;
    }
  } else {
    status.outcome = "no-plays";
  }

  for (const p of chosen) {
    if (!isPinnableName(p.fileHash)) continue;
    const target = path.join(dirs.pins, p.fileHash);
    if ((await sizeOf(target)) === p.length) continue; // already pinned
    if ((await freeBytes()) - p.length < floorBytes) {
      log(`disk floor reached; stopping`);
      status.outcome = "stopped-at-floor";
      break;
    }
    const name = fileNameOf(p.fileHash);
    try {
      const torrent = parseTorrent(await readFile(path.join(torrentDir, `${p.infohash}.torrent`)));
      await fetchVerified({
        url: torrent.urlList[0] ?? archiveUrlOf(p.fileHash),
        torrent,
        part: path.join(dirs.tmp, `${p.infohash}.part`),
        target,
        fetchImpl,
      });
      status.fetched++;
      log(`pinned ${name} (${(p.length / 1e6).toFixed(0)} MB)`);
    } catch (err) {
      status.failed++;
      log(`${name}: ${err.message}`);
    }
  }

  const m = await writeManifest({ stateDir, index });
  const present = await readPins(dirs.pins, index);
  Object.assign(status, { pinned: m.count, bytes: present.reduce((a, p) => a + p.bytes, 0) });
  await writeStatus();
  log(`${m.count} pinned, ${status.fetched} fetched, ${status.failed} failed, ${status.pruned} unpinned`);
  return status;
}

async function main() {
  const cacheDir = env("MIRROR_CACHE_DIR", "/var/cache/highdesert-mirror");
  await runWarm({
    stateDir: env("MIRROR_STATE_DIR", "/var/lib/highdesert-mirror"),
    statusPath: path.join(cacheDir, "warm-status.json"),
    torrentDir: env("MIRROR_TORRENT_DIR", "/var/lib/highdesert-mirror/torrents"),
    index: JSON.parse(await readFile(env("MIRROR_INDEX", path.join(here, "episodes.json")), "utf8")),
    budgetBytes: Number(env("MIRROR_PIN_MAX_GB", "15")) * GB,
    floorBytes: Number(env("MIRROR_DISK_FLOOR_GB", "10")) * GB,
    maxSteal: Number(env("MIRROR_WARM_MAX_STEAL", "20")),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[warm]", err);
    process.exit(1);
  });
}
