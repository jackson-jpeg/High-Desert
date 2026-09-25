import { Readable } from "node:stream";
import { torrentFromStream } from "../../../scripts/build-torrent-index.mjs";
import { parseTorrent } from "../lib/torrent-file.mjs";

/**
 * MPEG-1 Layer III frames, each numbered and salted with `seed`, so no two
 * ranges — and no two fixtures — look alike: a wrong offset or the wrong
 * file's bytes cannot compare equal by accident.
 */
export function fixtureMp3(seed = 1, frames = 3200) {
  const FRAME = 417; // 144 * 128000 / 44100, no padding
  const buf = Buffer.alloc(FRAME * frames);
  for (let i = 0; i < frames; i++) {
    const o = i * FRAME;
    buf.writeUInt32BE(0xfffb9004, o); // sync, MPEG-1 L3, 128k, 44.1k, stereo
    buf.writeUInt32BE(i, o + 36);
    buf.writeUInt32BE(seed, o + 40);
    for (let j = 44; j < FRAME; j++) buf[o + j] = (i * 31 + j * seed + seed) & 0xff;
  }
  return buf;
}

/** A single-file torrent of `bytes`, built by the same code that built the production index. */
export async function torrentOf(name, bytes, webseed) {
  const t = await torrentFromStream(name, Readable.from([bytes]), { webseed });
  return { buf: t.torrent, infohash: t.infohash, length: bytes.length, parsed: parseTorrent(t.torrent) };
}
