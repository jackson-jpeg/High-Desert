import { readdir, stat, rename, open, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

/**
 * The pin directory: `<stateDir>/pins/<fileHash>`, one verified MP3 per pinned
 * episode, named by its catalog fileHash so nginx can address it by the
 * URL-decoded path (lib/nginx.mjs). Nothing is written into it but a finished,
 * verified file, by rename from `<stateDir>/tmp` on the same filesystem — so a
 * name in this directory is a whole episode, never a download in progress.
 *
 * `<stateDir>/manifest.json` is what nginx serves as /mirror/manifest: the
 * episodes the mirror can play with archive.org gone. It is written here and
 * only here (the warm job and the migration), atomically.
 */

export const layout = (stateDir) => ({
  pins: path.join(stateDir, "pins"),
  // Re-encoded copies of episodes whose archive.org file changes configuration
  // midstream (scripts/repair-episode.mjs, docs/broken-episodes.md). nginx tries
  // here before pins/; the warm job never writes here and never pins one.
  repaired: path.join(stateDir, "repaired"),
  tmp: path.join(stateDir, "tmp"),
  catalog: path.join(stateDir, "catalog"),
  manifest: path.join(stateDir, "manifest.json"),
});

export function fileNameOf(fileHash) {
  // archive:{identifier}:{fileName} — the file name may itself contain ':'.
  const m = /^archive:[^:]+:(.+)$/.exec(fileHash);
  return m ? m[1] : null;
}

/** A catalog fileHash that can be a single path component. */
export function isPinnableName(fileHash) {
  return (
    typeof fileHash === "string" &&
    fileNameOf(fileHash) !== null &&
    !fileHash.includes("/") &&
    !fileHash.includes("\0") &&
    Buffer.byteLength(fileHash) <= 255
  );
}

/**
 * The pinned episodes that are really there: a catalog fileHash, a regular
 * file, and exactly the catalogued length. A short file — a copy interrupted
 * by a full disk, or anything not written by rename — is left out, because a
 * listed episode that cannot play sends a listener into a wait for nothing.
 */
export async function readPins(pinDir, index) {
  let names = [];
  try {
    names = await readdir(pinDir);
  } catch {
    return [];
  }
  const out = [];
  for (const fileHash of names) {
    const e = index[fileHash];
    if (!e) continue;
    let s;
    try {
      s = await stat(path.join(pinDir, fileHash));
    } catch {
      continue;
    }
    if (!s.isFile() || s.size !== e.length) continue;
    out.push({ fileHash, infohash: e.infohash, bytes: s.size });
  }
  return out.sort((a, b) => (a.fileHash < b.fileHash ? -1 : a.fileHash > b.fileHash ? 1 : 0));
}

/**
 * The repaired copies that are really there: listed in the record
 * (src/data/repaired-episodes.json, `[{fileHash, repaired: {bytes}}]`), a
 * regular file, exactly the recorded length. Same rule as a pin: a listed
 * episode that cannot play sends a listener into a wait for nothing.
 */
export async function readRepaired(dir, repairs = []) {
  const out = [];
  for (const r of repairs) {
    if (!isPinnableName(r.fileHash)) continue;
    try {
      const s = await stat(path.join(dir, r.fileHash));
      if (s.isFile() && s.size === r.repaired?.bytes) out.push({ fileHash: r.fileHash, bytes: s.size });
    } catch {
      /* not installed here */
    }
  }
  return out.sort((a, b) => (a.fileHash < b.fileHash ? -1 : a.fileHash > b.fileHash ? 1 : 0));
}

/** The record's hashes: never pinned, since their archive.org file is the broken one. */
export function repairedSet(repairs = []) {
  return new Set(repairs.map((r) => r.fileHash));
}

/**
 * `{version, count, pinned, repaired, fileHashes}`; `version` is a digest of
 * the sorted list. `count` is everything the mirror can play with archive.org
 * gone: the pins plus the repaired copies (`repaired` of them).
 */
export function manifestOf(fileHashes, repaired = 0) {
  const sorted = [...new Set(fileHashes)].sort();
  const version = createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16);
  return { version, count: sorted.length, pinned: sorted.length - repaired, repaired, fileHashes: sorted };
}

/** Write `body` to `target` by rename from a sibling temp file, fsynced first. */
export async function writeAtomic(target, body) {
  const tmp = `${target}.${process.pid}.tmp`;
  const fh = await open(tmp, "w", 0o644);
  try {
    await fh.writeFile(body);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Rewrite the manifest from what is in the pin directory now. Atomic: nginx
 * may be half way through sending the previous one, and a reader holding the
 * old file keeps the old bytes.
 */
export async function writeManifest({ stateDir, index, repairs = [] }) {
  const { pins, repaired, manifest } = layout(stateDir);
  const skip = repairedSet(repairs);
  const pinned = (await readPins(pins, index)).map((p) => p.fileHash).filter((h) => !skip.has(h));
  const fixed = (await readRepaired(repaired, repairs)).map((p) => p.fileHash);
  const m = manifestOf([...pinned, ...fixed], fixed.length);
  await writeAtomic(manifest, JSON.stringify(m) + "\n");
  return m;
}
