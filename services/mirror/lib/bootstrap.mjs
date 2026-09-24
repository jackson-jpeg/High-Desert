import { lookup as dnsLookup } from "node:dns/promises";

/**
 * DHT bootstrap nodes, resolved to IPv4 here rather than by the DHT library.
 *
 * bittorrent-dht listens on a udp4 socket but hands hostnames to Node's
 * resolver, which on this server answers dht.transmissionbt.com (and others)
 * with an IPv6 address first. A udp4 socket cannot send there, nothing says
 * so, and the DHT reports "ready" with zero nodes — which is what it did on
 * this box until this existed: 0 nodes, 0 peers, for every infohash, including
 * a well-seeded Ubuntu ISO. The library's defaults also include two routers
 * (router.bittorrent.com, router.utorrent.com) that no longer answer.
 */
export const BOOTSTRAP = [
  { host: "dht.libtorrent.org", port: 25401 },
  { host: "dht.transmissionbt.com", port: 6881 },
  { host: "router.bittorrent.com", port: 6881 },
  { host: "router.utorrent.com", port: 6881 },
];

/** `ip:port` for every bootstrap host that has an IPv4 address; unresolvable ones are skipped. */
export async function dhtBootstrap(nodes = BOOTSTRAP, lookup = dnsLookup) {
  const out = [];
  for (const { host, port } of nodes) {
    try {
      const { address } = await lookup(host, { family: 4 });
      out.push(`${address}:${port}`);
    } catch {
      /* no A record, or DNS is down: the others may still answer */
    }
  }
  return out;
}
