import { createHash } from "node:crypto";

/**
 * Just enough bencode to read a .torrent: its infohash (sha1 of the exact info
 * bytes), file list, piece length and piece hashes. Shared by the gateway's
 * warm job (to verify a webseed download before pinning it) and
 * scripts/build-torrent-index.mjs.
 */
export function bdecode(buf) {
  let i = 0;
  const infoSpan = { start: -1, end: -1 };
  function next(depth, key) {
    const c = buf[i];
    if (c === 0x69) {
      const end = buf.indexOf(0x65, i);
      const n = Number(buf.toString("latin1", i + 1, end));
      i = end + 1;
      return n;
    }
    if (c === 0x6c) {
      i++;
      const out = [];
      while (buf[i] !== 0x65) out.push(next(depth + 1));
      i++;
      return out;
    }
    if (c === 0x64) {
      const start = i;
      i++;
      const out = {};
      while (buf[i] !== 0x65) {
        const k = next(depth + 1).toString("utf8");
        out[k] = next(depth + 1, k);
      }
      i++;
      if (depth === 1 && key === "info") {
        infoSpan.start = start;
        infoSpan.end = i;
      }
      return out;
    }
    if (c >= 0x30 && c <= 0x39) {
      const colon = buf.indexOf(0x3a, i);
      const len = Number(buf.toString("latin1", i, colon));
      const s = buf.subarray(colon + 1, colon + 1 + len);
      i = colon + 1 + len;
      return s;
    }
    throw new Error(`bencode: unexpected byte ${c} at ${i}`);
  }
  const value = next(0);
  return { value, infoSpan };
}

export function parseTorrent(buf) {
  const { value, infoSpan } = bdecode(buf);
  if (infoSpan.start < 0) throw new Error("torrent has no info dict");
  const info = value.info;
  const name = info.name.toString("utf8");
  const files = info.files
    ? info.files.map((f, index) => ({ index, path: f.path.map((p) => p.toString("utf8")).join("/"), length: f.length }))
    : [{ index: 0, path: name, length: info.length }];
  const pieces = [];
  for (let o = 0; o < info.pieces.length; o += 20) pieces.push(info.pieces.subarray(o, o + 20));
  return {
    infohash: createHash("sha1").update(buf.subarray(infoSpan.start, infoSpan.end)).digest("hex"),
    name,
    pieceLength: info["piece length"],
    pieces,
    files,
    creationDate: value["creation date"] ?? null,
    urlList: (value["url-list"] ?? []).map((u) => u.toString("utf8")),
  };
}

/** Check a single-file torrent's content against its piece hashes, streaming. Returns the byte count. */
export async function verifyAgainst(torrent, stream) {
  const { pieceLength, pieces } = torrent;
  let idx = 0;
  let inPiece = 0;
  let h = createHash("sha1");
  let total = 0;
  const check = () => {
    const got = h.digest();
    if (!pieces[idx] || !got.equals(pieces[idx])) throw new Error(`piece ${idx} does not match`);
    idx++;
    h = createHash("sha1");
    inPiece = 0;
  };
  for await (const chunk of stream) {
    const buf = Buffer.from(chunk);
    let off = 0;
    while (off < buf.length) {
      const take = Math.min(pieceLength - inPiece, buf.length - off);
      h.update(buf.subarray(off, off + take));
      inPiece += take;
      off += take;
      if (inPiece === pieceLength) check();
    }
    total += buf.length;
  }
  if (inPiece > 0) check();
  if (idx !== pieces.length) throw new Error(`${idx} of ${pieces.length} pieces present`);
  return total;
}
