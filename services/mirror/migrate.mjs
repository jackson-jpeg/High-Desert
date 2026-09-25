#!/usr/bin/env node
/**
 * One-time move from the torrent gateway's cache to nginx's pin directory.
 * Idempotent: run it as often as you like (scripts/deploy-mirror.sh runs it
 * on every deploy), it only ever finishes what is left.
 *
 *   before: <cacheDir>/data/<infohash>/<fileName>  + <cacheDir>/data/<infohash>/.complete
 *   after:  <stateDir>/pins/<fileHash>
 *
 * Only files the gateway marked complete (verified against every piece hash
 * when they were written) and whose size is the catalogued length are moved,
 * by rename — the same filesystem, so no byte is copied or re-downloaded. If
 * rename cannot work (another filesystem), the file is copied to
 * `<stateDir>/tmp`, its size checked, renamed into place, and only then is the
 * original removed.
 *
 * Never deletes a file it could not place. A complete file that is the wrong
 * size, or whose fileHash cannot be a path, stays exactly where it is and is
 * reported. Incomplete (never-verified) torrent directories are removed only
 * with --drop-partials. The old gateway's pins.json and state.json go once
 * nothing is left in data/.
 *
 *   node migrate.mjs [--drop-partials]   (MIRROR_CACHE_DIR, MIRROR_STATE_DIR, MIRROR_INDEX)
 *   node migrate.mjs --reverse           put the pins back where the torrent
 *                                        gateway reads them (rollback only)
 */
import { readFile, readdir, rename, rm, rmdir, stat, mkdir, copyFile, chmod, access, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layout, fileNameOf, isPinnableName, writeManifest } from "./lib/pins.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const exists = (p) => access(p).then(() => true, () => false);

async function sizeOf(p) {
  try {
    const s = await stat(p);
    return s.isFile() ? s.size : -1;
  } catch {
    return -1;
  }
}

/** Put `src` at `dst`: rename, or copy + check + rename across filesystems. */
async function place(src, dst, tmpDir, length) {
  try {
    await rename(src, dst);
    return;
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }
  const tmp = path.join(tmpDir, `migrate-${path.basename(path.dirname(src))}.part`);
  await copyFile(src, tmp);
  if ((await sizeOf(tmp)) !== length) {
    await rm(tmp, { force: true });
    throw new Error("copy is the wrong size");
  }
  await chmod(tmp, 0o644);
  await rename(tmp, dst);
  await rm(src);
}

export async function migrate({ cacheDir, stateDir, index, dropPartials = false, log = () => {} }) {
  const dirs = layout(stateDir);
  await mkdir(dirs.pins, { recursive: true, mode: 0o755 });
  await mkdir(dirs.tmp, { recursive: true, mode: 0o700 });
  const report = { moved: 0, already: 0, partialsDropped: 0, partialsKept: 0, unknown: 0, kept: [] };
  const byInfohash = new Map(Object.entries(index).map(([fh, e]) => [e.infohash, { fileHash: fh, ...e }]));
  const data = path.join(cacheDir, "data");

  let names = [];
  try {
    names = await readdir(data);
  } catch {
    /* nothing to migrate */
  }
  for (const ih of names) {
    const dir = path.join(data, ih);
    const e = byInfohash.get(ih);
    if (!e) {
      report.unknown++;
      report.kept.push({ infohash: ih, why: "not in the index" });
      continue;
    }
    const complete = await exists(path.join(dir, ".complete"));
    if (!complete) {
      if (dropPartials) {
        await rm(dir, { recursive: true, force: true });
        report.partialsDropped++;
      } else {
        report.partialsKept++;
      }
      continue;
    }
    const name = fileNameOf(e.fileHash);
    const src = path.join(dir, name);
    const dst = path.join(dirs.pins, e.fileHash);
    const keep = (why) => report.kept.push({ infohash: ih, fileHash: e.fileHash, why });
    if (!isPinnableName(e.fileHash)) {
      keep("fileHash cannot be a file name");
      continue;
    }
    const srcSize = await sizeOf(src);
    if ((await sizeOf(dst)) === e.length) {
      // Placed by an earlier run (or the warm job). The old copy, if any, is
      // a second link or a duplicate of verified bytes: safe to let go.
      if (srcSize >= 0) await rm(src);
      report.already++;
    } else if (srcSize !== e.length) {
      keep(srcSize < 0 ? "marked complete but the file is missing" : `size ${srcSize}, catalogued ${e.length}`);
      continue;
    } else {
      try {
        await chmod(src, 0o644);
        await place(src, dst, dirs.tmp, e.length);
        report.moved++;
      } catch (err) {
        keep(`could not place: ${err.message}`);
        continue;
      }
    }
    // The directory held one file and its marker; both are accounted for.
    await rm(path.join(dir, ".complete"), { force: true });
    await rmdir(dir).catch(() => keep("directory not empty after the move"));
  }

  const left = await readdir(data).catch(() => null);
  if (left && left.length === 0) {
    await rmdir(data);
    await rm(path.join(cacheDir, "pins.json"), { force: true });
    await rm(path.join(cacheDir, "state.json"), { force: true });
  }
  const m = await writeManifest({ stateDir, index });
  report.manifest = { version: m.version, count: m.count };
  log(JSON.stringify(report));
  return report;
}

/**
 * The way back, for scripts/deploy-mirror.sh --rollback to the torrent
 * gateway: each pin returns to `data/<infohash>/<fileName>` with its
 * `.complete` marker, and `pins.json` lists them, so the gateway serves and
 * protects them exactly as before. Renames only; a pin whose slot is already
 * taken is left where it is.
 */
export async function unmigrate({ cacheDir, stateDir, index }) {
  const { pins } = layout(stateDir);
  let names = [];
  try {
    names = await readdir(pins);
  } catch {
    /* nothing pinned */
  }
  const back = [];
  for (const fileHash of names) {
    const e = index[fileHash];
    if (!e) continue;
    const dir = path.join(cacheDir, "data", e.infohash);
    const dst = path.join(dir, fileNameOf(fileHash));
    if (await exists(dst)) continue;
    await mkdir(dir, { recursive: true });
    await rename(path.join(pins, fileHash), dst);
    await writeFile(path.join(dir, ".complete"), "");
    back.push(e.infohash);
  }
  let prior = [];
  try {
    prior = JSON.parse(await readFile(path.join(cacheDir, "pins.json"), "utf8"));
  } catch {
    /* none */
  }
  await writeFile(path.join(cacheDir, "pins.json"), JSON.stringify([...new Set([...prior, ...back])].sort()));
  await writeManifest({ stateDir, index });
  return { restored: back.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = (k, d) => process.env[k] ?? d;
  const index = JSON.parse(await readFile(env("MIRROR_INDEX", path.join(here, "episodes.json")), "utf8"));
  if (process.argv.includes("--reverse")) {
    const r = await unmigrate({
      cacheDir: env("MIRROR_CACHE_DIR", "/var/cache/highdesert-mirror"),
      stateDir: env("MIRROR_STATE_DIR", "/var/lib/highdesert-mirror"),
      index,
    });
    console.log(`[migrate --reverse] ${r.restored} pins returned to the gateway's cache`);
    process.exit(0);
  }
  const r = await migrate({
    cacheDir: env("MIRROR_CACHE_DIR", "/var/cache/highdesert-mirror"),
    stateDir: env("MIRROR_STATE_DIR", "/var/lib/highdesert-mirror"),
    index,
    dropPartials: process.argv.includes("--drop-partials"),
  });
  console.log(`[migrate] moved ${r.moved}, already in place ${r.already}, partials dropped ${r.partialsDropped} / kept ${r.partialsKept}, ` +
    `kept in place ${r.kept.length}; manifest ${r.manifest.count} episodes (${r.manifest.version})`);
  for (const k of r.kept) console.log(`[migrate] kept ${k.infohash} ${k.fileHash ?? ""}: ${k.why}`);
}
