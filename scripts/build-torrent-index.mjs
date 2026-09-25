#!/usr/bin/env node
/**
 * Build data/torrents/index.json: for every catalog episode, the archive.org
 * torrent that carries it (infohash) and the episode's index in that torrent's
 * file list — or `fileIndex: null` when the torrent does not carry it.
 *
 *   node scripts/build-torrent-index.mjs            # fetch what is missing, rebuild the index
 *   node scripts/build-torrent-index.mjs --refresh  # re-fetch every .torrent
 *
 * archive.org serves one torrent per *item* (`{id}/{id}_archive.torrent`), and
 * every episode here lives in the same item, so this is one request, not 1,312.
 * Written for the general case anyway: one fetch per distinct identifier, at
 * most 2 per second, each .torrent saved to data/torrents/{id}.torrent and
 * reused on the next run (resumable, idempotent — same inputs, same bytes out).
 *
 * The finding that shaped the mirror (docs/torrent-mirror-feasibility.md): the
 * item's torrent was generated 2024-03-05 and lists only the item's two
 * metadata files. None of the MP3s are in it, so every episode maps to
 * `fileIndex: null`. The index says so rather than guessing.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "data/torrents");
const MIN_INTERVAL_MS = 500; // ≤ 2 requests per second

import { bdecode, parseTorrent } from "../services/mirror/lib/torrent-file.mjs";
import { TRACKERS } from "../services/mirror/lib/magnet.mjs";
export { bdecode, parseTorrent };

// ── the index ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

let lastRequest = 0;
async function politeFetch(url) {
  const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(url, { headers: { "user-agent": "highdesert.space torrent-index (+https://highdesert.space)" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function buildIndex({ catalog, refresh = false, fetchTorrent = politeFetch, outDir = OUT_DIR, log = console.log }) {
  await mkdir(outDir, { recursive: true });
  const ids = [...new Set(catalog.map((e) => e.archiveIdentifier).filter(Boolean))].sort();
  const torrents = {};
  for (const id of ids) {
    const file = path.join(outDir, `${id}.torrent`);
    let buf;
    if (!refresh && (await exists(file))) {
      buf = await readFile(file);
    } else {
      buf = await fetchTorrent(`https://archive.org/download/${id}/${id}_archive.torrent`);
      await writeFile(file, buf);
      log(`fetched ${id}_archive.torrent (${buf.length} bytes)`);
    }
    torrents[id] = parseTorrent(buf);
  }

  const episodes = {};
  let covered = 0;
  for (const ep of [...catalog].sort((a, b) => a.fileHash.localeCompare(b.fileHash))) {
    const t = torrents[ep.archiveIdentifier];
    if (!t) continue;
    const f = t.files.find((x) => x.path === ep.fileName);
    if (f) covered++;
    episodes[ep.fileHash] = { identifier: ep.archiveIdentifier, infohash: t.infohash, fileIndex: f ? f.index : null };
  }

  const index = {
    torrents: Object.fromEntries(
      Object.entries(torrents).map(([id, t]) => [
        id,
        {
          infohash: t.infohash,
          createdAt: t.creationDate ? new Date(t.creationDate * 1000).toISOString() : null,
          pieceLength: t.pieceLength,
          files: t.files.length,
          episodeFiles: t.files.filter((f) => /\.mp3$/i.test(f.path)).length,
          webseeds: t.urlList,
        },
      ]),
    ),
    coverage: { episodes: catalog.length, inATorrent: covered },
    episodes,
  };
  await writeFile(path.join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}

// ── per-episode torrents (--hash) ────────────────────────────────────────────
//
// Because archive.org's item torrent carries no episode, this makes one: a
// single-file torrent per episode, 256 KiB pieces, hashed by streaming the MP3
// once from archive.org (nothing is kept), with the archive.org file URL as its
// BEP-19 webseed so any client can fetch it while archive.org is up. The bytes
// are deterministic — same file, same infohash — so anyone can regenerate and
// check them. Torrents go to `--torrent-dir` (default the gateway's
// /var/lib/highdesert-mirror/torrents); infohashes go into index.json, saved
// after every episode so an interrupted run resumes where it stopped.

export const EPISODE_PIECE_LENGTH = 256 * 1024;

function benc(v) {
  if (typeof v === "number") return Buffer.from(`i${v}e`);
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(`${v.length}:`), v]);
  if (typeof v === "string") return benc(Buffer.from(v, "utf8"));
  if (Array.isArray(v)) return Buffer.concat([Buffer.from("l"), ...v.map(benc), Buffer.from("e")]);
  const keys = Object.keys(v).sort();
  return Buffer.concat([Buffer.from("d"), ...keys.flatMap((k) => [benc(k), benc(v[k])]), Buffer.from("e")]);
}
export { benc as bencode };

/** Hash a byte stream into a single-file torrent. */
export async function torrentFromStream(name, stream, { webseed, pieceLength = EPISODE_PIECE_LENGTH } = {}) {
  const pieces = [];
  let piece = createHash("sha1");
  let inPiece = 0;
  let length = 0;
  for await (const chunk of stream) {
    let off = 0;
    const buf = Buffer.from(chunk);
    while (off < buf.length) {
      const take = Math.min(pieceLength - inPiece, buf.length - off);
      piece.update(buf.subarray(off, off + take));
      inPiece += take;
      off += take;
      if (inPiece === pieceLength) {
        pieces.push(piece.digest());
        piece = createHash("sha1");
        inPiece = 0;
      }
    }
    length += buf.length;
  }
  if (inPiece > 0) pieces.push(piece.digest());
  const info = { length, name, "piece length": pieceLength, pieces: Buffer.concat(pieces) };
  const infoBuf = benc(info);
  const torrent = benc({
    announce: TRACKERS[0],
    "announce-list": TRACKERS.map((t) => [t]),
    "created by": "highdesert.space",
    info,
    ...(webseed ? { "url-list": [webseed] } : {}),
  });
  return { torrent, infohash: createHash("sha1").update(infoBuf).digest("hex"), length, pieceLength };
}

async function hashEpisodes({ catalog, torrentDir, order, limit }) {
  const file = path.join(OUT_DIR, "episodes.json");
  const done = (await exists(file)) ? JSON.parse(await readFile(file, "utf8")) : {};
  await mkdir(torrentDir, { recursive: true });
  const todo = order(catalog).filter((e) => !done[e.fileHash]).slice(0, limit);
  console.log(`${Object.keys(done).length} hashed, ${todo.length} to do`);
  let n = 0;
  for (const ep of todo) {
    const url = ep.sourceUrl;
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    const started = Date.now();
    try {
      const res = await fetch(url, { headers: { "user-agent": "highdesert.space torrent-index (+https://highdesert.space)" } });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const t = await torrentFromStream(ep.fileName, res.body, { webseed: url });
      await writeFile(path.join(torrentDir, `${t.infohash}.torrent`), t.torrent);
      done[ep.fileHash] = { infohash: t.infohash, length: t.length, pieceLength: t.pieceLength };
      // Sorted keys: the file is byte-identical however the run was split.
      const sorted = Object.fromEntries(Object.entries(done).sort(([a], [b]) => a.localeCompare(b)));
      await writeFile(file, JSON.stringify(sorted, null, 1) + "\n");
      n++;
      const mb = t.length / 1e6;
      console.log(`[${n}/${todo.length}] ${t.infohash} ${mb.toFixed(1)} MB ${(mb / ((Date.now() - started) / 1000)).toFixed(1)} MB/s ${ep.fileName}`);
    } catch (err) {
      console.warn(`skip ${ep.fileName}: ${err.message}`);
    }
  }
}

async function communityPlays() {
  try {
    const res = await fetch("https://highdesert.space/api/stats/community");
    const body = await res.json();
    return body.episodes ?? {};
  } catch {
    return {};
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--hash")) {
  const catalog = JSON.parse(await readFile(path.join(ROOT, "public/seed/library.json"), "utf8"));
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const plays = await communityPlays();
  // src/lib/utils/community-key.ts, restated (this script runs without a TS loader).
  const key = (e) => `${e.archiveIdentifier}--${e.fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)}`;
  await hashEpisodes({
    catalog,
    torrentDir: arg("--torrent-dir", "/var/lib/highdesert-mirror/torrents"),
    limit: Number(arg("--limit", "100000")),
    // Most-played first: the episodes a mirror is likeliest to need get torrents first.
    order: (c) => [...c].sort((a, b) => (plays[key(b)]?.plays ?? 0) - (plays[key(a)]?.plays ?? 0) || a.fileHash.localeCompare(b.fileHash)),
  });
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const catalog = JSON.parse(await readFile(path.join(ROOT, "public/seed/library.json"), "utf8"));
  const index = await buildIndex({ catalog, refresh: process.argv.includes("--refresh") });
  const { episodes, inATorrent } = index.coverage;
  console.log(`${inATorrent} of ${episodes} episodes are in an archive.org torrent`);
  for (const [id, t] of Object.entries(index.torrents)) {
    console.log(`  ${id}: btih ${t.infohash}, ${t.files} files (${t.episodeFiles} mp3), created ${t.createdAt}`);
  }
}
