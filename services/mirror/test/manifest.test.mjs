// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cache } from "../lib/cache.mjs";
import { createGateway } from "../lib/gateway.mjs";

/**
 * GET /mirror/manifest — the episodes the mirror can play with archive.org
 * gone. The client decides from it, before any request, whether a start can
 * work at all; a file listed here that is not on disk sends a listener into a
 * 15 s wait, and one left out is reported unplayable when it would have played.
 */

let cleanup = [];
afterEach(async () => {
  for (const f of cleanup.reverse()) await f();
  cleanup = [];
});

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const STRAY = "e".repeat(40);
const INDEX = {
  "archive:coll:1997-01-01 Pinned.mp3": { infohash: A, length: 10 },
  "archive:coll:1998-02-02 Kept.mp3": { infohash: B, length: 10 },
  "archive:coll:1999-03-03 Partial.mp3": { infohash: C, length: 10 },
};

async function setup({ manifestTtlMs = 0 } = {}) {
  const tmp = await mkdtemp(path.join(tmpdir(), "hd-mirror-manifest-"));
  cleanup.push(() => rm(tmp, { recursive: true, force: true }));
  const cache = new Cache({ root: path.join(tmp, "cache"), maxBytes: 1e9, floorBytes: 0, freeBytes: async () => 1e12 });
  await cache.load();
  // A: complete and pinned. B: complete, kept by the LRU. C: a partial
  // download. STRAY: complete, but not an episode in the index.
  for (const ih of [A, B, STRAY]) await cache.markComplete(ih);
  await mkdir(cache.dir(C), { recursive: true });
  await writeFile(path.join(cache.root, "pins.json"), JSON.stringify([A]));
  await cache.loadPins();
  const gateway = createGateway({ cache, torrentDir: path.join(tmp, "torrents"), index: INDEX, client: {}, manifestTtlMs });
  const server = http.createServer((req, res) => void gateway.handle(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  cleanup.push(() => new Promise((r) => server.close(r)));
  return { cache, gateway, url: `http://127.0.0.1:${server.address().port}/mirror/manifest` };
}

describe("GET /mirror/manifest", () => {
  it("lists every complete episode on disk — pinned or kept — and nothing partial or unknown", async () => {
    const { url } = await setup();
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const m = await res.json();
    expect(m.fileHashes).toEqual(["archive:coll:1997-01-01 Pinned.mp3", "archive:coll:1998-02-02 Kept.mp3"]);
    expect(m.count).toBe(2);
    expect(m.pinned).toBe(1);
    expect(m.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes version when the playable set changes, and answers 304 to the version a client holds", async () => {
    const { url, cache } = await setup();
    const first = await (await fetch(url)).json();
    const again = await fetch(url, { headers: { "if-none-match": `"${first.version}"` } });
    expect(again.status).toBe(304);

    await cache.markComplete(C);
    const next = await (await fetch(url, { headers: { "if-none-match": `"${first.version}"` } })).json();
    expect(next.version).not.toBe(first.version);
    expect(next.fileHashes).toContain("archive:coll:1999-03-03 Partial.mp3");
  });

  it("is memoised for its TTL rather than re-reading the cache on every request", async () => {
    const { url, cache } = await setup({ manifestTtlMs: 60_000 });
    const first = await (await fetch(url)).json();
    await cache.markComplete(C);
    const second = await (await fetch(url)).json();
    expect(second.version).toBe(first.version);
  });

  it("is not mistaken for an episode called 'manifest'", async () => {
    const { url } = await setup();
    const res = await fetch(url);
    expect(res.status).not.toBe(404);
  });
});
