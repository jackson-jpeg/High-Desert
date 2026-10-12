/**
 * Just enough MPEG audio parsing for the level tap (src/audio/level-tap/tap.ts):
 * where the audio starts after an ID3v2 tag, where a frame starts inside an
 * arbitrary byte range, how far a run of same-format frames goes, and how a
 * playback time maps to a byte offset (Xing/Info header, or the average rate).
 *
 * Pure: bytes in, numbers out. Every rule here is held by
 * src/audio/level-tap/__tests__/mpeg.test.ts.
 */

export interface FrameHeader {
  /** 1, 2 or 2.5 (MPEG-1, MPEG-2, MPEG-2.5). */
  version: 1 | 2 | 2.5;
  layer: 1 | 2 | 3;
  /** Bits per second. */
  bitrate: number;
  sampleRate: number;
  channels: 1 | 2;
  /** PCM samples per channel in one frame. */
  samples: number;
  /** The whole frame, header included, in bytes. */
  length: number;
}

const BITRATES_V1 = [
  [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], // layer 1
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], // layer 2
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // layer 3
];
const BITRATES_V2 = [
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], // layer 1
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // layers 2 and 3
];
const SAMPLE_RATES: Record<number, number[]> = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  2.5: [11025, 12000, 8000],
};

/**
 * Bytes taken by an ID3v2 tag at the start of `b` (header, body and footer),
 * or 0 when there is none. The catalog's tags carry cover art and run to
 * ~77 KB, so this is routinely bigger than a first read.
 */
export function id3Length(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  const footer = b[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

/** The frame header at `i`, or null if the four bytes there are not one. */
export function parseHeader(b: Uint8Array, i: number): FrameHeader | null {
  if (i < 0 || i + 4 > b.length) return null;
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const verBits = (b[i + 1] >> 3) & 3;
  const layerBits = (b[i + 1] >> 1) & 3;
  if (verBits === 1 || layerBits === 0) return null;
  const version: 1 | 2 | 2.5 = verBits === 3 ? 1 : verBits === 2 ? 2 : 2.5;
  const layer = (4 - layerBits) as 1 | 2 | 3;
  const brIdx = (b[i + 2] >> 4) & 15;
  const srIdx = (b[i + 2] >> 2) & 3;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const padding = (b[i + 2] >> 1) & 1;
  const channels: 1 | 2 = ((b[i + 3] >> 6) & 3) === 3 ? 1 : 2;
  const kbps = version === 1 ? BITRATES_V1[layer - 1][brIdx] : BITRATES_V2[layer === 1 ? 0 : 1][brIdx];
  const bitrate = kbps * 1000;
  const sampleRate = SAMPLE_RATES[version][srIdx];
  const samples = layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576;
  const length =
    layer === 1
      ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
      : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
  return { version, layer, bitrate, sampleRate, channels, samples, length };
}

function sameFormat(a: FrameHeader, b: FrameHeader): boolean {
  return a.version === b.version && a.layer === b.layer && a.sampleRate === b.sampleRate && a.channels === b.channels;
}

/**
 * The first offset at or after `from` where a frame really starts: a valid
 * header whose computed length lands on a second valid header of the same
 * format. A byte range cut anywhere in a file starts mid-frame, and 0xFFE
 * occurs in compressed data often enough that one header alone is a guess.
 * -1 when there is none.
 */
export function findSync(b: Uint8Array, from = 0): number {
  for (let i = Math.max(0, from); i + 4 <= b.length; i++) {
    if (b[i] !== 0xff) continue;
    const h = parseHeader(b, i);
    if (!h) continue;
    const next = parseHeader(b, i + h.length);
    if (next && sameFormat(h, next)) return i;
  }
  return -1;
}

/**
 * Walk complete frames from `start` while they keep the first one's format.
 * Stops at a partial frame (the end of a byte range), at anything that is not
 * a header, and at a change of sample rate or channels, which is what makes
 * a decoder refuse the whole buffer (the repaired shows had exactly that,
 * docs/broken-episodes.md). `end` is exclusive.
 */
export function frameRun(b: Uint8Array, start: number): { end: number; frames: number; header: FrameHeader | null } {
  const first = parseHeader(b, start);
  if (!first) return { end: start, frames: 0, header: null };
  let i = start;
  let frames = 0;
  for (;;) {
    const h = parseHeader(b, i);
    if (!h || !sameFormat(first, h) || i + h.length > b.length) break;
    i += h.length;
    frames++;
  }
  return { end: i, frames, header: first };
}

export interface XingInfo {
  /** "Xing" marks VBR; "Info" is LAME's tag on a constant-bitrate file. */
  vbr: boolean;
  frames?: number;
  bytes?: number;
  /** 100 entries, 0-255: the byte position (of 256ths) at each percent of the time. */
  toc?: number[];
}

/** The Xing/Info tag inside the frame at `i`, if it carries one. */
export function parseXing(b: Uint8Array, i: number, h: FrameHeader): XingInfo | null {
  const side = h.version === 1 ? (h.channels === 1 ? 17 : 32) : h.channels === 1 ? 9 : 17;
  const at = i + 4 + side;
  if (at + 8 > b.length) return null;
  const tag = String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  if (tag !== "Xing" && tag !== "Info") return null;
  const flags = ((b[at + 4] << 24) | (b[at + 5] << 16) | (b[at + 6] << 8) | b[at + 7]) >>> 0;
  let p = at + 8;
  const u32 = () => {
    const v = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
    p += 4;
    return v;
  };
  const out: XingInfo = { vbr: tag === "Xing" };
  if (flags & 1 && p + 4 <= b.length) out.frames = u32();
  if (flags & 2 && p + 4 <= b.length) out.bytes = u32();
  if (flags & 4 && p + 100 <= b.length) {
    out.toc = Array.from(b.subarray(p, p + 100));
    p += 100;
  }
  return out;
}

/**
 * How playback time maps to bytes in one file. `audioStart` is the first
 * audio frame after the tag (and after a Xing/Info frame, which is silent);
 * `audioBytes` is everything from there to the end when it is known.
 */
export interface StreamMap {
  audioStart: number;
  audioBytes?: number;
  /** Xing's table of contents, used only for a VBR file whose length agrees with it. */
  toc?: number[];
  /** The first frame's bitrate, bits per second: the rate when nothing better is known. */
  bitrate: number;
}

/** Average bytes per second of audio: the file's own figures when known, else the header's. */
export function bytesPerSecond(map: StreamMap, duration: number): number {
  if (map.audioBytes && Number.isFinite(duration) && duration > 0) return map.audioBytes / duration;
  return map.bitrate / 8;
}

/** The byte offset at which playback time `t` (seconds) is, as near as the file says. */
export function timeToByte(map: StreamMap, t: number, duration: number): number {
  const time = Math.max(0, t);
  if (map.toc && map.audioBytes && Number.isFinite(duration) && duration > 0) {
    const pct = Math.min(99.999, (time / duration) * 100);
    const a = Math.floor(pct);
    const fa = map.toc[a];
    const fb = a < 99 ? map.toc[a + 1] : 256;
    const fx = fa + (fb - fa) * (pct - a);
    return Math.round(map.audioStart + (fx / 256) * map.audioBytes);
  }
  return Math.round(map.audioStart + time * bytesPerSecond(map, duration));
}

/** The playback time (seconds) at byte offset `byte`: timeToByte's inverse. */
export function byteToTime(map: StreamMap, byte: number, duration: number): number {
  const rel = Math.max(0, byte - map.audioStart);
  if (map.toc && map.audioBytes && Number.isFinite(duration) && duration > 0) {
    const fx = (rel / map.audioBytes) * 256;
    let a = 0;
    while (a < 99 && map.toc[a + 1] <= fx) a++;
    const fa = map.toc[a];
    const fb = a < 99 ? map.toc[a + 1] : 256;
    const frac = fb > fa ? Math.min(1, Math.max(0, (fx - fa) / (fb - fa))) : 0;
    return ((a + frac) / 100) * duration;
  }
  return rel / bytesPerSecond(map, duration);
}
