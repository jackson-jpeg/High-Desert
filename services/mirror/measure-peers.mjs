#!/usr/bin/env node
/**
 * How many peers outside this server hold our episodes? Samples infohashes
 * and asks the mainline DHT and the magnet links' trackers, each for up to
 * `--wait` seconds. Nothing is downloaded and nothing is announced as held:
 * the DHT lookup is get_peers only, and the tracker announce says left > 0.
 *
 *   node services/mirror/measure-peers.mjs [--sample 50] [--wait 25] [--self <ip>]
 *        [--control <infohash>] [--random <n>] [--addrs] [--extra <infohash>...]
 *
 * `--self` is this server's public address: our own tracker announce comes
 * back as a peer and must not be counted as someone else. `--control` is a
 * torrent known to be well seeded (a current Ubuntu ISO): "zero peers" for our
 * episodes is only evidence if the same instrument, in the same run, finds
 * peers for it (docs/disconnected-checks.md). `--random` is the negative
 * control: infohashes of random bytes, which nobody can hold. Some DHT nodes
 * answer get_peers for any hash at all (indexers, spies); a "peer" rate on our
 * episodes no higher than on random hashes is that noise, not a seeder.
 *
 * Prints one JSON line per infohash, then a summary line. Used for
 * docs/torrent-mirror-feasibility.md.
 */
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import DHT from "bittorrent-dht";
import TrackerClient from "bittorrent-tracker";
import { TRACKERS } from "./lib/magnet.mjs";
import { dhtBootstrap } from "./lib/bootstrap.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const SAMPLE = Number(arg("sample", "50"));
const WAIT_S = Number(arg("wait", "25"));
const extraAt = process.argv.indexOf("--extra");
const SELF = arg("self", null);
const CONTROL = arg("control", null);
const RANDOM = Number(arg("random", "0"));
const EXTRA = extraAt >= 0 ? process.argv.slice(extraAt + 1).filter((a) => /^[0-9a-f]{40}$/i.test(a)) : [];

const index = JSON.parse(await readFile(path.join(here, "../../data/torrents/episodes.json"), "utf8"));
const all = Object.entries(index);
// Evenly spaced through the list (ordered most-played first), so the sample
// covers popular and obscure shows alike.
const step = Math.max(1, Math.floor(all.length / SAMPLE));
const sample = all.filter((_, i) => i % step === 0).slice(0, SAMPLE).map(([fileHash, e]) => ({ fileHash, infohash: e.infohash, length: e.length }));
for (const ih of EXTRA) sample.push({ fileHash: null, infohash: ih.toLowerCase(), length: null });
for (let i = 0; i < RANDOM; i++) sample.push({ fileHash: "RANDOM", infohash: randomBytes(20).toString("hex"), length: 1 << 26, random: true });
if (CONTROL) sample.unshift({ fileHash: "CONTROL", infohash: CONTROL.toLowerCase(), length: null, control: true });

const dht = new DHT({ bootstrap: await dhtBootstrap() });
await new Promise((r) => dht.listen(0, r));
await new Promise((r) => (dht.ready ? r() : dht.once("ready", r)));
// Let the routing table fill before the first lookup.
await new Promise((r) => setTimeout(r, 5000));

const peerId = randomBytes(20);
const own = new Set(SELF ? [SELF] : []); // our own public address, never counted as outside

async function measure({ fileHash, infohash, length, control = false, random = false }) {
  const dhtPeers = new Set();
  const trackerPeers = new Set();
  const trackerSeen = {};
  const onPeer = (peer, ih) => {
    if (ih.toString("hex") === infohash) dhtPeers.add(`${peer.host}:${peer.port}`);
  };
  dht.on("peer", onPeer);
  dht.lookup(infohash);

  const tracker = new TrackerClient({
    infoHash: infohash,
    peerId,
    announce: TRACKERS,
    port: 6881,
    getAnnounceOpts: () => ({ uploaded: 0, downloaded: 0, left: length ?? 1, numwant: 50 }),
  });
  tracker.on("error", () => {});
  tracker.on("warning", () => {});
  tracker.on("peer", (addr) => trackerPeers.add(addr));
  tracker.on("update", (d) => {
    trackerSeen[d.announce] = { complete: d.complete, incomplete: d.incomplete };
  });
  tracker.start();

  await new Promise((r) => setTimeout(r, WAIT_S * 1000));
  dht.removeListener("peer", onPeer);
  tracker.stop();
  tracker.destroy();

  const outside = new Set([...dhtPeers, ...trackerPeers].filter((a) => !own.has(a.split(":")[0])));
  const row = { control, random, fileHash, infohash, dhtPeers: dhtPeers.size, trackerPeers: trackerPeers.size, trackers: trackerSeen, outside: outside.size };
  // --addrs: the outside addresses themselves, for telling a real peer from a
  // DHT node that answers get_peers for every hash. Third parties' addresses:
  // for the terminal, never for the doc.
  if (process.argv.includes("--addrs") && !control) row.outsideAddrs = [...outside];
  return row;
}

// Ten at a time: a burst of 50 lookups is rude to the DHT and to the trackers.
const results = [];
for (let i = 0; i < sample.length; i += 10) {
  const batch = await Promise.all(sample.slice(i, i + 10).map(measure));
  for (const r of batch) console.log(JSON.stringify(r));
  results.push(...batch);
}
const dhtNodes = dht.toJSON().nodes.length;
dht.destroy();

const episodes = results.filter((r) => !r.control && !r.random);
const randoms = results.filter((r) => r.random);
const controlRow = results.find((r) => r.control);
const withPeers = episodes.filter((r) => r.outside > 0);
console.log(
  JSON.stringify({
    summary: true,
    sampled: episodes.length,
    waitS: WAIT_S,
    dhtNodes,
    self: SELF,
    controlOutside: controlRow ? controlRow.outside : null,
    withOutsidePeers: withPeers.length,
    random: randoms.length,
    randomWithOutsidePeers: randoms.filter((r) => r.outside > 0).length,
    totalOutsidePeers: episodes.reduce((a, r) => a + r.outside, 0),
    trackersAnswered: episodes.filter((r) => Object.keys(r.trackers).length > 0).length,
  }),
);
process.exit(0);
