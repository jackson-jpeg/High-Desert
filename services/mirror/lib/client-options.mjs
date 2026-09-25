import { dhtBootstrap } from "./bootstrap.mjs";

/**
 * The WebTorrent client's options, from the unit's environment.
 *
 * `blocklist` holds our own public address. Every torrent's tracker hands our
 * own announce back as a peer, and without it the client held a uTP
 * connection to itself in each direction for every seeded torrent — 677 of
 * them with 338 pins, for nothing.
 */
export async function clientOptions(env, { bootstrap = dhtBootstrap } = {}) {
  const get = (k, d) => env[k] ?? d;
  const publicPeer = get("MIRROR_PUBLIC_PEER", "") || null;
  const selfHost = publicPeer ? publicPeer.replace(/:\d+$/, "") : null;
  return {
    uploadLimit: Number(get("MIRROR_UPLOAD_KBPS", "2048")) * 1024,
    torrentPort: Number(get("MIRROR_TORRENT_PORT", "6881")),
    dhtPort: Number(get("MIRROR_DHT_PORT", "6882")),
    // A server: no LAN discovery, no router port-mapping.
    lsd: false,
    natUpnp: false,
    natPmp: false,
    webSeeds: true,
    // IPv4, resolved here: see bootstrap.mjs for why the defaults found nothing.
    dht: { bootstrap: await bootstrap() },
    ...(selfHost ? { blocklist: [selfHost] } : {}),
  };
}
