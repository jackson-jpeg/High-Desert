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

  const ranked = await plays();
  const { pins: chosen, bytes } = choosePins(ranked, index, budgetBytes);
  log(`${chosen.length} episodes, ${(bytes / GB).toFixed(1)} GB within ${(budgetBytes / GB).toFixed(1)} GB`);
  Object.assign(status, { targetPinned: chosen.length, targetBytes: bytes, budgetBytes, floorBytes });

  // Anything in the pin directory that is not a whole catalog episode (a name
  // outside the catalog, a wrong length) is not a pin and never was.
  const present = await readPins(dirs.pins, index);
  const real = new Set(present.map((p) => p.fileHash));
  for (const name of await readdir(dirs.pins)) {
    if (!real.has(name)) await rm(path.join(dirs.pins, name), { force: true });
  }

  // What fell out of the top. It is unpinned only once what replaces it is in,
  // or to make room for that one: never first. Pruning first is how the pin
  // set shrank from 339 to 318 on 2026-09-27: thirteen were dropped, then the
  // disk floor stopped their replacements, and the mirror simply held less.
  // An empty choice is a database with no plays in it, not a verdict that
  // nothing is worth keeping, so it unpins nothing at all.
  const keep = new Set(chosen.map((p) => p.fileHash));
  const rank = new Map(ranked.map((r, i) => [r.episodeId, i]));
  const rankOf = (x) => rank.get(communityKeyOf(x.fileHash)) ?? Infinity;
  // Least played first: the first to go when room is needed.
  const extras = present.filter((p) => !keep.has(p.fileHash)).sort((a, b) => rankOf(b) - rankOf(a));
  let pinnedBytes = present.reduce((a, p) => a + p.bytes, 0);
  const unpin = async (x) => {
    await rm(path.join(dirs.pins, x.fileHash), { force: true });
    pinnedBytes -= x.bytes;
    status.pruned++;
  };
  if (chosen.length === 0) status.outcome = "no-plays";

  for (const p of chosen) {
    if (!isPinnableName(p.fileHash)) continue;
    const target = path.join(dirs.pins, p.fileHash);
    if ((await sizeOf(target)) === p.length) continue; // already pinned
    // Room in the budget: an out-of-top pin makes way for a top one.
    while (pinnedBytes + p.length > budgetBytes && extras.length > 0) await unpin(extras.shift());
    // Room on the disk. nginx's fill cache yields first (its min_free sits
    // above this floor, lib/nginx.mjs), so what is short here is short for
    // pins: swap out-of-top pins for this one only when that makes it fit, and
    // otherwise stop with every pin still in place.
    const free = await freeBytes();
    if (free - p.length < floorBytes) {
      const reclaimable = extras.reduce((a, x) => a + x.bytes, 0);
      if (free + reclaimable - p.length < floorBytes) {
        log(`disk floor reached; stopping`);
        status.outcome = "stopped-at-floor";
        break;
      }
      let freed = 0;
      while (free + freed - p.length < floorBytes) {
        const x = extras.shift();
        await unpin(x);
        freed += x.bytes;
      }
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
      pinnedBytes += p.length;
      log(`pinned ${name} (${(p.length / 1e6).toFixed(0)} MB)`);
    } catch (err) {
      status.failed++;
      log(`${name}: ${err.message}`);
    }
  }

  // Every top pin is in, so what is left over from before has been replaced.
  const have = new Set((await readPins(dirs.pins, index)).map((p) => p.fileHash));
  if (chosen.length > 0 && chosen.every((p) => have.has(p.fileHash))) {
    for (const x of extras.splice(0)) await unpin(x);
  }

  const m = await writeManifest({ stateDir, index });
  const pinned = await readPins(dirs.pins, index);
  Object.assign(status, {
    pinned: m.count,
    bytes: pinned.reduce((a, p) => a + p.bytes, 0),
    // How far the pin set is from what the budget chose. The status line WARNs
    // on any shortfall rather than letting the mirror shrink silently.
    targetMissing: chosen.filter((p) => !pinned.some((x) => x.fileHash === p.fileHash)).length,
    freeBytes: await freeBytes(),
  });
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
