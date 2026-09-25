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

/** `{version, count, pinned, fileHashes}`; `version` is a digest of the sorted list. */
export function manifestOf(fileHashes) {
  const sorted = [...fileHashes].sort();
  const version = createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16);
  return { version, count: sorted.length, pinned: sorted.length, fileHashes: sorted };
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
export async function writeManifest({ stateDir, index }) {
  const { pins, manifest } = layout(stateDir);
  const m = manifestOf((await readPins(pins, index)).map((p) => p.fileHash));
  await writeAtomic(manifest, JSON.stringify(m) + "\n");
  return m;
}
