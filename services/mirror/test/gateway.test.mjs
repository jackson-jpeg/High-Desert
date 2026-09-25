// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { mkdtemp, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebTorrent from "webtorrent";
import { Cache } from "../lib/cache.mjs";
import { createGateway } from "../lib/gateway.mjs";
import { parseRange } from "../lib/range.mjs";

/**
 * The gateway end to end: a real torrent made from a small MP3, seeded by a
 * second WebTorrent client in this process, fetched by the gateway over TCP,
 * served as HTTP ranges. No network beyond loopback; no DHT, trackers or
 * webseeds — the peer is added directly, which is the outage case exactly:
 * the only source is someone else holding the bytes.
 */

const QUIET = { dht: false, tracker: false, lsd: false, natUpnp: false, natPmp: false, utp: false, webSeeds: false };

/** ~1.3 MB of 128 kbps MPEG-1 Layer III frames, each numbered so no two ranges look alike. */
function fixtureMp3() {
  const FRAME = 417; // 144 * 128000 / 44100, no padding
  const frames = 3200;
  const buf = Buffer.alloc(FRAME * frames);
  for (let i = 0; i < frames; i++) {
    const o = i * FRAME;
    buf.writeUInt32BE(0xfffb9004, o); // sync, MPEG-1 L3, 128k, 44.1k, stereo
    buf.writeUInt32BE(i, o + 36);
    for (let j = 40; j < FRAME; j++) buf[o + j] = (i * 31 + j) & 0xff;
  }
  return buf;
}

const MP3 = fixtureMp3();
const L = MP3.length;
const FILE_HASH = "archive:fixture-coll:1997-09-11 - Coast to Coast AM - Fixture.mp3";
const NAME = "1997-09-11 - Coast to Coast AM - Fixture.mp3";

let tmp, seeder, client, server, base, gateway, cache, infohash;

async function listen(c) {
  if (c.torrentPort) return c.torrentPort;
  await new Promise((r) => c.once("listening", r));
  return c.torrentPort;
}

beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "hd-mirror-"));
  const torrentDir = path.join(tmp, "torrents");
  await mkdir(torrentDir);

  seeder = new WebTorrent(QUIET);
  const seeded = await new Promise((resolve) => seeder.seed(MP3, { name: NAME, path: path.join(tmp, "seed") }, resolve));
  infohash = seeded.infoHash;
  await writeFile(path.join(torrentDir, `${infohash}.torrent`), seeded.torrentFile);
  const seedPort = await listen(seeder);

  cache = new Cache({ root: path.join(tmp, "cache"), maxBytes: 100 * 1024 ** 2, floorBytes: 0, freeBytes: async () => 1e12 });
  await cache.load();
  client = new WebTorrent(QUIET);
  gateway = createGateway({
    cache,
    torrentDir,
    index: { [FILE_HASH]: { infohash, length: L } },
    client,
    firstByteMs: 10_000,
    extraPeers: [`127.0.0.1:${seedPort}`],
    publicPeer: "127.0.0.1:6881",
  });
  server = http.createServer((req, res) => void gateway.handle(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/mirror/${encodeURIComponent(FILE_HASH)}`;
}, 30_000);

afterAll(async () => {
  server?.close();
  await gateway?.close();
  await new Promise((r) => client?.destroy(r));
  await new Promise((r) => seeder?.destroy(r));
  await rm(tmp, { recursive: true, force: true });
});

async function get(range, url = base) {
  const res = await fetch(url, { headers: range ? { range } : {} });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}

describe("GET /mirror/{fileHash} from a peer", () => {
  it("bytes=0- → 206, the whole file, a correct Content-Range", async () => {
    const r = await get("bytes=0-");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe(`bytes 0-${L - 1}/${L}`);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
    expect(Number(r.headers.get("content-length"))).toBe(L);
    expect(r.body.equals(MP3)).toBe(true);
  }, 30_000);

  it("a mid-file range → exactly those bytes", async () => {
    const a = 600_001;
    const b = 700_123;
    const r = await get(`bytes=${a}-${b}`);
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe(`bytes ${a}-${b}/${L}`);
    expect(r.body.length).toBe(b - a + 1);
    expect(r.body.equals(MP3.subarray(a, b + 1))).toBe(true);
  }, 30_000);

  it("a range past the end → 416 with bytes */length", async () => {
    const r = await get(`bytes=${L}-`);
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe(`bytes */${L}`);
  });

  it("no Range → 200, the whole file", async () => {
    const r = await get(null);
    expect(r.status).toBe(200);
    expect(r.body.equals(MP3)).toBe(true);
  }, 30_000);

  it("once complete, it is served from disk", async () => {
    await expect.poll(() => cache.isComplete(infohash), { timeout: 20_000 }).toBe(true);
    const before = gateway.stats().fromDisk;
    const r = await get("bytes=1000-1999");
    expect(r.body.equals(MP3.subarray(1000, 2000))).toBe(true);
    expect(gateway.stats().fromDisk).toBe(before + 1);
  }, 30_000);

  it("/mirror/magnet/{fileHash} → the torrent's magnet, with its webseed and the peer hint", async () => {
    const res = await fetch(base.replace("/mirror/", "/mirror/magnet/"));
    expect(res.status).toBe(200);
    const { magnet, infohash: ih } = await res.json();
    expect(ih).toBe(infohash);
    expect(magnet).toMatch(new RegExp(`^magnet:\\?xt=urn:btih:${infohash}&dn=`));
    expect(magnet).toContain("x.pe=127.0.0.1%3A6881");
    expect(decodeURIComponent(magnet)).toContain(NAME);
  });

  it("an unknown episode → 404", async () => {
    const r = await get(null, base.replace(/Fixture/, "Nope"));
    expect(r.status).toBe(404);
  });
});

describe("nothing delivers", () => {
  it("→ 503 JSON within the first-byte budget", async () => {
    const lonely = new WebTorrent(QUIET);
    const other = new WebTorrent(QUIET);
    const t = await new Promise((resolve) => other.seed(Buffer.from("x".repeat(70_000)), { name: "gone.mp3", path: path.join(tmp, "gone") }, resolve));
    const torrentDir = path.join(tmp, "torrents-gone");
    await mkdir(torrentDir);
    await writeFile(path.join(torrentDir, `${t.infoHash}.torrent`), t.torrentFile);
    await new Promise((r) => other.destroy(r)); // the only holder leaves
    const c2 = new Cache({ root: path.join(tmp, "cache-gone"), maxBytes: 1e9, floorBytes: 0, freeBytes: async () => 1e12 });
    await c2.load();
    const g = createGateway({
      cache: c2,
      torrentDir,
      index: { "archive:c:gone.mp3": { infohash: t.infoHash, length: 70_000 } },
      client: lonely,
      firstByteMs: 800,
    });
    const s = http.createServer((req, res) => void g.handle(req, res));
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const started = Date.now();
    const res = await fetch(`http://127.0.0.1:${s.address().port}/mirror/${encodeURIComponent("archive:c:gone.mp3")}`, {
      headers: { range: "bytes=0-" },
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("mirror-unavailable");
    expect(Date.now() - started).toBeLessThan(5_000);
    s.close();
    await g.close();
    await new Promise((r) => lonely.destroy(r));
  }, 30_000);
});

describe("the cache", () => {
  async function fill(root, infohash, bytes) {
    const d = path.join(root, "data", infohash);
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, "f.mp3"), Buffer.alloc(bytes, 1));
  }

  it("evicts least recently served first, and never a pinned file", async () => {
    const root = path.join(tmp, "lru");
    let now = 0;
    const c = new Cache({ root, maxBytes: 250_000, floorBytes: 0, now: () => now, freeBytes: async () => 1e12 });
    await c.load();
    await writeFile(path.join(root, "pins.json"), JSON.stringify(["pinned-oldest"]));
    await c.loadPins();
    for (const [ih, t] of [["pinned-oldest", 1], ["a-old", 2], ["b-mid", 3], ["c-new", 4]]) {
      await fill(root, ih, 100_000);
      now = t;
      c.touch(ih);
    }
    const evicted = await c.evict();
    // 300 kB unpinned against a 250 kB cap: one goes, the oldest unpinned.
    expect(evicted).toEqual(["a-old"]);
    expect((await readdir(path.join(root, "data"))).sort()).toEqual(["b-mid", "c-new", "pinned-oldest"]);
  });

  it("the disk-free floor evicts even under the byte cap, and still spares pins and busy files", async () => {
    const root = path.join(tmp, "floor");
    let free = 0;
    const c = new Cache({ root, maxBytes: 1e12, floorBytes: 150_000, freeBytes: async () => free });
    await c.load();
    await writeFile(path.join(root, "pins.json"), JSON.stringify(["p"]));
    await c.loadPins();
    for (const [ih, t] of [["p", 1], ["busy", 2], ["x", 3], ["y", 4]]) {
      await fill(root, ih, 100_000);
      c.state.entries[ih] = { lastAccess: t };
    }
    c.busy.add("busy");
    free = 0;
    const evicted = await c.evict();
    expect(evicted).toEqual(["x", "y"]);
    expect((await readdir(path.join(root, "data"))).sort()).toEqual(["busy", "p"]);
  });
});

describe("parseRange", () => {
  it.each([
    ["bytes=0-", 100, { start: 0, end: 99 }],
    ["bytes=10-19", 100, { start: 10, end: 19 }],
    ["bytes=90-500", 100, { start: 90, end: 99 }],
    ["bytes=-10", 100, { start: 90, end: 99 }],
    ["bytes=-500", 100, { start: 0, end: 99 }],
    ["bytes=100-", 100, { unsatisfiable: true }],
    ["bytes=20-10", 100, { unsatisfiable: true }],
    ["bytes=-0", 100, { unsatisfiable: true }],
    ["bytes=0-9,20-29", 100, { start: 0, end: 9 }],
    ["items=0-9", 100, null],
    ["bytes=-", 100, null],
    [undefined, 100, null],
  ])("%s of %i", (h, len, want) => {
    expect(parseRange(h, len)).toEqual(want);
  });
});
