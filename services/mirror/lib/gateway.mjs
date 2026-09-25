import { createReadStream } from "node:fs";
import { readFile, readdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseRange } from "./range.mjs";
import { parseTorrent } from "./torrent-file.mjs";
import { magnetFor } from "./magnet.mjs";

/**
 * GET /mirror/{fileHash} — an episode, as same-origin HTTP range responses,
 * from wherever the bytes can be had while archive.org is not answering.
 *
 *   1. A complete copy in the cache (pinned by the warm job, or kept from an
 *      earlier request) is read straight off disk.
 *   2. Otherwise the episode's torrent is added on demand. Its sources are the
 *      archive.org webseed (useless during an outage, which is the point of
 *      the next two) plus TCP/uTP peers found through DHT and the trackers.
 *      webtorrent's file iterator marks the requested range's pieces critical,
 *      so a seek is fetched first, not after everything before it.
 *   3. If no byte arrives within `firstByteMs`, 503 with a JSON body — the
 *      client's cue to give up on the mirror too and raise its error dialog.
 *
 * Browsers only ever see this origin; BitTorrent never reaches them.
 * Torrents are dropped `idleMs` after their last request (the data stays in
 * the cache for the LRU to decide); pinned ones stay added and seed back.
 */

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

export function fileNameOf(fileHash) {
  // archive:{identifier}:{fileName} — the file name may itself contain ':'.
  const m = /^archive:[^:]+:(.+)$/.exec(fileHash);
  return m ? m[1] : null;
}

export function createGateway({
  cache,
  torrentDir,
  index,
  client,
  firstByteMs = 15_000,
  idleMs = 5 * 60_000,
  extraPeers = [],
  publicPeer = null,
  manifestTtlMs = 60_000,
  log = () => {},
}) {
  /** infohash → { torrent, lastUse, streams, pinned } */
  const active = new Map();
  const counters = { served: 0, fromDisk: 0, fromTorrent: 0, unavailable: 0, notFound: 0, rangeNotSatisfiable: 0 };

  async function ensureTorrent(infohash, { pinned = false } = {}) {
    const have = active.get(infohash);
    if (have) {
      have.pinned ||= pinned;
      return have;
    }
    const buf = await readFile(path.join(torrentDir, `${infohash}.torrent`));
    // A complete file was verified against the piece hashes when it was
    // written (warm.mjs, or the client's own download). Re-verifying on add
    // re-read all 15 GB of pins at every start and held the unit at its
    // memory ceiling for minutes.
    const skipVerify = await cache.isComplete(infohash);
    const slot = { torrent: null, lastUse: Date.now(), streams: 0, pinned };
    active.set(infohash, slot);
    cache.busy.add(infohash);
    slot.torrent = await new Promise((resolve, reject) => {
      const t = client.add(buf, { path: cache.dir(infohash), skipVerify });
      t.once("error", reject);
      t.once("ready", () => resolve(t));
    }).catch((err) => {
      active.delete(infohash);
      cache.busy.delete(infohash);
      throw err;
    });
    for (const p of extraPeers) slot.torrent.addPeer(p);
    const markDone = async () => {
      await cache.markComplete(infohash);
      log(`complete ${infohash}`);
    };
    if (slot.torrent.done) await markDone();
    else slot.torrent.once("done", () => void markDone());
    return slot;
  }

  async function dropTorrent(infohash) {
    const slot = active.get(infohash);
    if (!slot) return;
    active.delete(infohash);
    await new Promise((r) => slot.torrent.destroy({ destroyStore: false }, r));
    cache.busy.delete(infohash);
  }

  /** Drop idle unpinned torrents, then let the cache evict. */
  async function sweep() {
    const now = Date.now();
    for (const [ih, slot] of active) {
      if (!slot.pinned && slot.streams === 0 && now - slot.lastUse > idleMs) await dropTorrent(ih);
    }
    return cache.evict();
  }

  async function seedPins() {
    await cache.loadPins();
    for (const ih of cache.pins) {
      if (!(await cache.isComplete(ih))) continue;
      try {
        await ensureTorrent(ih, { pinned: true });
      } catch (err) {
        log(`cannot seed ${ih}: ${err.message}`);
      }
    }
    for (const [ih, slot] of active) if (slot.pinned && !cache.pins.has(ih)) slot.pinned = false;
  }

  // Our own addresses. Each torrent's tracker hands back our own announce, so
  // the client dials itself; counting those wires reported 677 "peers" on a
  // swarm measured to have none (docs/torrent-mirror-feasibility.md) — the
  // bulk of them were not outside peers.
  const selfHosts = new Set(["127.0.0.1", "::1", publicPeer ? publicPeer.replace(/:\d+$/, "") : null].filter(Boolean));
  const bareHost = (a) => (a ?? "").replace(/^::ffff:/, "");

  /**
   * `peers` is distinct outside addresses on non-webseed wires — people, not
   * connections, and never ourselves. `wires` is the raw count by type, for
   * diagnosis.
   */
  function stats() {
    const outside = new Set();
    const wires = {};
    for (const { torrent } of active.values()) {
      for (const w of torrent?.wires ?? []) {
        wires[w.type] = (wires[w.type] ?? 0) + 1;
        if (w.type === "webSeed") continue;
        const host = bareHost(w.remoteAddress);
        if (host && !selfHosts.has(host)) outside.add(host);
      }
    }
    return { active: active.size, pinned: cache.pins.size, peers: outside.size, wires, ...counters };
  }

  /**
   * What the mirror can play right now with no help from archive.org: every
   * episode whose file is complete on disk — the warm job's pins, plus any
   * unpinned file an earlier request finished and the LRU has kept. During an
   * outage nothing new can arrive (the webseed is archive.org, and nobody else
   * seeds these), so this is exactly the set that will play.
   *
   * The client reads it to decide, before touching the network, whether a
   * start can work (src/audio/sources.ts) — a show not in it would otherwise
   * sit through the 15 s first-byte budget and fail anyway. `version` is a
   * digest of the list, so a client holding the same one learns nothing new.
   * Memoised for `manifestTtlMs`: it is a readdir plus a stat per entry.
   */
  let manifestMemo = null;
  const fileHashOf = new Map(Object.entries(index).map(([fh, e]) => [e.infohash, fh]));
  async function manifest() {
    if (manifestMemo && Date.now() - manifestMemo.at < manifestTtlMs) return manifestMemo.body;
    let names = [];
    try {
      names = await readdir(path.join(cache.root, "data"));
    } catch {
      /* no cache yet: an empty manifest */
    }
    const fileHashes = [];
    let pinned = 0;
    for (const ih of names) {
      const fh = fileHashOf.get(ih);
      if (!fh || !(await cache.isComplete(ih))) continue;
      fileHashes.push(fh);
      if (cache.pins.has(ih)) pinned++;
    }
    fileHashes.sort();
    const version = createHash("sha256").update(fileHashes.join("\n")).digest("hex").slice(0, 16);
    const body = { version, count: fileHashes.length, pinned, fileHashes };
    manifestMemo = { at: Date.now(), body };
    return body;
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://mirror");
    if (url.pathname === "/mirror/manifest" && (req.method === "GET" || req.method === "HEAD")) {
      const m = await manifest();
      const etag = `"${m.version}"`;
      const headers = { "content-type": "application/json", "cache-control": "public, max-age=60", etag };
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, headers);
        return res.end();
      }
      res.writeHead(200, headers);
      return res.end(req.method === "HEAD" ? undefined : JSON.stringify(m));
    }
    if (url.pathname === "/mirror/health") {
      const u = await cache.usage();
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true, cacheBytes: u.total, pinnedBytes: u.pinned, ...stats() }));
      return;
    }
    const mag = /^\/mirror\/magnet\/(.+)$/.exec(url.pathname);
    if (mag && req.method === "GET") {
      const fh = decodeURIComponent(mag[1]);
      const e = index[fh];
      if (!e) {
        res.writeHead(404, JSON_HEADERS);
        res.end(JSON.stringify({ error: "unknown-episode" }));
        return;
      }
      const t = parseTorrent(await readFile(path.join(torrentDir, `${e.infohash}.torrent`)));
      res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=86400" });
      res.end(JSON.stringify({
        infohash: e.infohash,
        magnet: magnetFor({ infohash: e.infohash, name: t.name, webseed: t.urlList[0], peer: publicPeer }),
      }));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...JSON_HEADERS, allow: "GET, HEAD" });
      res.end(JSON.stringify({ error: "method-not-allowed" }));
      return;
    }
    const m = /^\/mirror\/(.+)$/.exec(url.pathname);
    const fileHash = m ? decodeURIComponent(m[1]) : null;
    const entry = fileHash ? index[fileHash] : null;
    const name = fileHash ? fileNameOf(fileHash) : null;
    if (!entry || !name) {
      counters.notFound++;
      res.writeHead(404, JSON_HEADERS);
      res.end(JSON.stringify({ error: "unknown-episode" }));
      return;
    }
    const { infohash, length } = entry;
    const range = parseRange(req.headers.range, length);
    if (range?.unsatisfiable) {
      counters.rangeNotSatisfiable++;
      res.writeHead(416, { ...JSON_HEADERS, "content-range": `bytes */${length}` });
      res.end(JSON.stringify({ error: "range-not-satisfiable", length }));
      return;
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : length - 1;
    const headers = {
      "content-type": "audio/mpeg",
      "accept-ranges": "bytes",
      "content-length": String(end - start + 1),
      "cache-control": "no-store",
      "x-mirror-infohash": infohash,
      ...(range ? { "content-range": `bytes ${start}-${end}/${length}` } : {}),
    };
    const status = range ? 206 : 200;
    cache.touch(infohash);

    // 1. Complete on disk.
    const onDisk = path.join(cache.dir(infohash), name);
    if ((await cache.isComplete(infohash)) && (await exists(onDisk))) {
      counters.served++;
      counters.fromDisk++;
      res.writeHead(status, headers);
      if (req.method === "HEAD") return res.end();
      createReadStream(onDisk, { start, end }).pipe(res);
      return;
    }

    // 2. The torrent, within the first-byte budget.
    const deadline = Date.now() + firstByteMs;
    let slot;
    try {
      slot = await withTimeout(ensureTorrent(infohash), firstByteMs);
    } catch (err) {
      return unavailable(res, infohash, `torrent: ${err.message}`);
    }
    slot.lastUse = Date.now();
    if (req.method === "HEAD") {
      res.writeHead(status, headers);
      return res.end();
    }
    const file = slot.torrent.files.find((f) => f.name === name) ?? slot.torrent.files[0];
    slot.streams++;
    const stream = file.createReadStream({ start, end });
    const release = () => {
      if (stream.released) return;
      stream.released = true;
      slot.streams--;
      slot.lastUse = Date.now();
    };
    stream.once("close", release);
    res.once("close", () => {
      stream.destroy();
      release();
    });

    let first;
    try {
      first = await withTimeout(firstChunk(stream), Math.max(0, deadline - Date.now()));
    } catch {
      stream.destroy();
      release();
      return unavailable(res, infohash, "no data within budget");
    }
    counters.served++;
    counters.fromTorrent++;
    res.writeHead(status, headers);
    if (first) res.write(first);
    // pipe() resumes the stream firstChunk paused, and handles backpressure.
    stream.once("error", () => res.destroy());
    stream.pipe(res);
  }

  function unavailable(res, infohash, why) {
    counters.unavailable++;
    log(`503 ${infohash}: ${why}`);
    if (res.headersSent) return res.destroy();
    res.writeHead(503, { ...JSON_HEADERS, "retry-after": "30" });
    res.end(JSON.stringify({ error: "mirror-unavailable", infohash, waitedMs: firstByteMs }));
  }

  async function close() {
    for (const ih of [...active.keys()]) await dropTorrent(ih);
    await cache.save();
  }

  return { handle, sweep, seedPins, stats, close, ensureTorrent, active, manifest };
}

function exists(p) {
  return access(p).then(() => true, () => false);
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/** The stream's first chunk, pausing it so nothing is lost before it is piped. */
function firstChunk(stream) {
  return new Promise((resolve, reject) => {
    const onData = (c) => {
      cleanup();
      stream.pause();
      resolve(c);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (e) => {
      cleanup();
      reject(e);
    };
    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onError);
  });
}
