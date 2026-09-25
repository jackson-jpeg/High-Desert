#!/usr/bin/env node
/**
 * highdesert-mirror: the gateway on 127.0.0.1:3004, proxied by nginx at
 * /mirror/. Configuration is environment only (deploy/highdesert-mirror.service):
 *
 *   MIRROR_PORT            3004
 *   MIRROR_CACHE_DIR       /var/cache/highdesert-mirror
 *   MIRROR_TORRENT_DIR     /var/lib/highdesert-mirror/torrents
 *   MIRROR_INDEX           ./episodes.json   (data/torrents/episodes.json)
 *   MIRROR_CACHE_MAX_GB    20    unpinned bytes on disk
 *   MIRROR_DISK_FLOOR_GB   10    free space never goes below this
 *   MIRROR_UPLOAD_KBPS     2048  seeding cap (2 MB/s)
 *   MIRROR_FIRST_BYTE_MS   15000
 *   MIRROR_TORRENT_PORT    6881  TCP + uTP; MIRROR_DHT_PORT 6882
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebTorrent from "webtorrent";
import { Cache } from "./lib/cache.mjs";
import { createGateway } from "./lib/gateway.mjs";
import { clientOptions } from "./lib/client-options.mjs";
import { startServer } from "./lib/serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = (k, d) => process.env[k] ?? d;
const GB = 1024 ** 3;

const cache = new Cache({
  root: env("MIRROR_CACHE_DIR", "/var/cache/highdesert-mirror"),
  maxBytes: Number(env("MIRROR_CACHE_MAX_GB", "20")) * GB,
  floorBytes: Number(env("MIRROR_DISK_FLOOR_GB", "10")) * GB,
});
await cache.load();

const index = JSON.parse(await readFile(env("MIRROR_INDEX", path.join(here, "episodes.json")), "utf8"));

const client = new WebTorrent(await clientOptions(process.env));
client.on("error", (err) => console.error("[mirror] client:", err.message));

const gateway = createGateway({
  cache,
  torrentDir: env("MIRROR_TORRENT_DIR", "/var/lib/highdesert-mirror/torrents"),
  index,
  client,
  firstByteMs: Number(env("MIRROR_FIRST_BYTE_MS", "15000")),
  // x.pe in magnet links: where a torrent client can reach this seeder.
  publicPeer: env("MIRROR_PUBLIC_PEER", "") || null,
  log: (m) => console.log(`[mirror] ${m}`),
});

// Listen first; the pins are seeded in the background (lib/serve.mjs).
const { server, listening, seeding } = startServer({
  gateway,
  port: Number(env("MIRROR_PORT", "3004")),
  log: (m) => console.error(`[mirror] ${m}`),
});
await listening;
console.log(`[mirror] listening on 127.0.0.1:${server.address().port}, ${Object.keys(index).length} episodes indexed`);
seeding.then(() => console.log(`[mirror] seeding ${gateway.stats().active} torrent(s)`));

// Pins change nightly (warm job): re-read them, drop idle torrents, evict.
// Not before the startup seeding has finished, or two passes add the same pins.
setInterval(() => {
  seeding
    .then(() => gateway.seedPins())
    .then(() => gateway.sweep())
    .catch((err) => console.error("[mirror] sweep:", err.message));
}, 60_000).unref();

const shutdown = async () => {
  server.close();
  await gateway.close();
  client.destroy(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
