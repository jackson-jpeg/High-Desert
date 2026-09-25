// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "../lib/serve.mjs";
import { Cache } from "../lib/cache.mjs";
import { createGateway } from "../lib/gateway.mjs";

/**
 * The gateway's start, after the first nightly warm left 338 pins: seeding
 * them was awaited before listen(), and re-verified 15 GB on the way. Health
 * never answered inside deploy-mirror.sh's window, and the deploy — and its
 * rollback — left the mirror down.
 */

let cleanup = [];
afterEach(async () => {
  for (const f of cleanup.reverse()) await f();
  cleanup = [];
});

describe("startServer", () => {
  it("answers while seeding the pins has not finished — or never will", async () => {
    let seedCalls = 0;
    const gateway = {
      seedPins: () => {
        seedCalls++;
        return new Promise(() => {}); // 338 torrents, verifying
      },
      handle: async (req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, url: req.url }));
      },
    };
    const { server, listening } = startServer({ gateway, port: 0 });
    cleanup.push(() => new Promise((r) => server.close(r)));
    await listening;
    const res = await fetch(`http://127.0.0.1:${server.address().port}/mirror/health`, { signal: AbortSignal.timeout(2_000) });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // And seeding was started, not skipped.
    expect(seedCalls).toBe(1);
  });

  it("a request that throws is a 500, not a hung socket", async () => {
    const gateway = { seedPins: async () => {}, handle: async () => { throw new Error("boom"); } };
    const { server, listening } = startServer({ gateway, port: 0 });
    cleanup.push(() => new Promise((r) => server.close(r)));
    await listening;
    const res = await fetch(`http://127.0.0.1:${server.address().port}/mirror/x`, { signal: AbortSignal.timeout(2_000) });
    expect(res.status).toBe(500);
  });
});

describe("adding a torrent", () => {
  it("skips re-verification for a file already verified complete, and verifies anything else", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "hd-mirror-start-"));
    cleanup.push(() => rm(tmp, { recursive: true, force: true }));
    const torrentDir = path.join(tmp, "torrents");
    await mkdir(torrentDir);
    const DONE = "a".repeat(40);
    const PARTIAL = "b".repeat(40);
    for (const ih of [DONE, PARTIAL]) await writeFile(path.join(torrentDir, `${ih}.torrent`), "d4:infod4:name1:xee");

    const cache = new Cache({ root: path.join(tmp, "cache"), maxBytes: 1e9, floorBytes: 0, freeBytes: async () => 1e12 });
    await cache.load();
    await mkdir(cache.dir(DONE), { recursive: true });
    await cache.markComplete(DONE);

    const added = new Map();
    const client = {
      add(_buf, opts) {
        const t = new EventEmitter();
        t.done = true;
        t.wires = [];
        t.addPeer = () => {};
        t.destroy = (_o, cb) => cb?.();
        added.set(opts.path, opts);
        queueMicrotask(() => t.emit("ready"));
        return t;
      },
    };
    const gateway = createGateway({ cache, torrentDir, index: {}, client });
    await gateway.ensureTorrent(DONE, { pinned: true });
    await gateway.ensureTorrent(PARTIAL);
    expect(added.get(cache.dir(DONE)).skipVerify).toBe(true);
    expect(added.get(cache.dir(PARTIAL)).skipVerify).toBe(false);
  });
});
