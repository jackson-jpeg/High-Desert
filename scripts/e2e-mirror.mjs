/**
 * The e2e stack's own /mirror: every episode is four hours of silence.
 *
 * The tuned-in e2e tests used to stream the scheduled show from archive.org,
 * so a stalled archive.org stream on a CI runner failed them (PR #36's first
 * run). They now answer archive.org's audio requests with a redirect to this
 * origin's `/mirror/{fileHash}` (e2e/fixture-audio.ts), and the stack
 * (scripts/live-e2e-stack.mjs) serves this instead of nginx's mirror.
 *
 * The fixture is one 144-byte MPEG-1 Layer III frame (32 kbps, 32 kHz, mono,
 * all-zero side info and main data: it decodes to 36 ms of silence and depends
 * on no other frame) repeated to FIXTURE_SECONDS. It has to be long: the
 * station starts a show at the second it is at, often hours in, and a file
 * shorter than that would end on arrival. Nothing is stored — any byte range
 * is computed from the frame, so a seek three hours in costs one small read.
 * Constant bitrate and no Xing header: the browser's duration is exact.
 */

export const FRAME_BYTES = 144;
export const FRAME_SECONDS = 1152 / 32_000;
export const FIXTURE_SECONDS = 4 * 3600;
export const FIXTURE_FRAMES = Math.ceil(FIXTURE_SECONDS / FRAME_SECONDS);
export const FIXTURE_BYTES = FIXTURE_FRAMES * FRAME_BYTES;

/** 0xFFFB: sync, MPEG-1, Layer III, no CRC. 0x18: 32 kbps, 32 kHz, no padding. 0xC0: mono. */
export const FRAME = (() => {
  const f = Buffer.alloc(FRAME_BYTES);
  f.set([0xff, 0xfb, 0x18, 0xc0]);
  return f;
})();

/** Bytes [start, end] (inclusive) of the fixture, as a Buffer. */
export function fixtureBytes(start, end) {
  const out = Buffer.alloc(end - start + 1);
  for (let i = 0; i < out.length; ) {
    const at = (start + i) % FRAME_BYTES;
    const n = Math.min(FRAME_BYTES - at, out.length - i);
    FRAME.copy(out, i, at, at + n);
    i += n;
  }
  return out;
}

/** Parse a single `bytes=a-b` / `bytes=a-` / `bytes=-n` range. null = no (usable) Range header. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const n = Math.min(Number(m[2]), size);
    return { start: size - n, end: size - 1 };
  }
  return { start: Number(m[1]), end: m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1) };
}

const CHUNK = 64 * 1024;

/**
 * Answer a `/mirror/...` request the way nginx's mirror does for a pinned
 * episode: 200 with the length, 206 for a range, 416 for one past the end;
 * GET and HEAD only. `/mirror/manifest` is left to the caller (it 404s here,
 * which the app reads as "unknown", the same as an unreadable manifest).
 */
export function serveFixtureMirror(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }
  const headers = {
    "content-type": "audio/mpeg",
    "accept-ranges": "bytes",
    // The player's element is crossOrigin="anonymous"; the redirect that
    // brings it here from archive.org leaves its origin "null".
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  };
  const range = parseRange(req.headers.range, FIXTURE_BYTES);
  if (range && (range.start >= FIXTURE_BYTES || range.start > range.end)) {
    res.writeHead(416, { ...headers, "content-range": `bytes */${FIXTURE_BYTES}` });
    res.end();
    return;
  }
  const { start, end } = range ?? { start: 0, end: FIXTURE_BYTES - 1 };
  res.writeHead(range ? 206 : 200, {
    ...headers,
    "content-length": String(end - start + 1),
    ...(range ? { "content-range": `bytes ${start}-${end}/${FIXTURE_BYTES}` } : {}),
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  let at = start;
  const pump = () => {
    while (at <= end) {
      const to = Math.min(at + CHUNK - 1, end);
      const ok = res.write(fixtureBytes(at, to));
      at = to + 1;
      if (!ok) {
        res.once("drain", pump);
        return;
      }
    }
    res.end();
  };
  res.on("close", () => {
    at = end + 1;
  });
  pump();
}
