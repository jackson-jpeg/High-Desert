/**
 * A magnet URI for an episode's torrent: infohash, name, the trackers, and the
 * archive.org webseed (`ws=`, so a client can fetch while archive.org is up
 * even with no peers). This server no longer seeds (the torrent client was
 * removed, docs/torrent-mirror-feasibility.md), so there is no `x.pe` peer
 * hint unless a caller passes one.
 */
export const TRACKERS = ["udp://tracker.opentrackr.org:1337/announce", "udp://open.stealth.si:80/announce"];

export function magnetFor({ infohash, name, webseed, peer }) {
  const q = [`xt=urn:btih:${infohash}`, `dn=${encodeURIComponent(name)}`];
  for (const t of TRACKERS) q.push(`tr=${encodeURIComponent(t)}`);
  if (webseed) q.push(`ws=${encodeURIComponent(webseed)}`);
  if (peer) q.push(`x.pe=${encodeURIComponent(peer)}`);
  return `magnet:?${q.join("&")}`;
}
