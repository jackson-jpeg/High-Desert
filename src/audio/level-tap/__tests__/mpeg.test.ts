/**
 * The level tap's MPEG parsing, against real bytes: the committed meter
 * fixture (e2e/assets/meter-tone.mp3: a 20 KB ID3 tag, a LAME Info frame,
 * then MPEG-2 Layer III, 16 kbps, 22,050 Hz, mono) and frames built here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  byteToTime,
  bytesPerSecond,
  findSync,
  frameRun,
  id3Length,
  parseHeader,
  parseXing,
  timeToByte,
  type StreamMap,
} from "../mpeg";

const FIXTURE = new Uint8Array(readFileSync(path.join(process.cwd(), "e2e/assets/meter-tone.mp3")));

/** Every frame start in the fixture, walked from the first frame after the tag. */
function frameStarts(b: Uint8Array): number[] {
  const out: number[] = [];
  let i = id3Length(b);
  for (;;) {
    const h = parseHeader(b, i);
    if (!h || i + h.length > b.length) break;
    out.push(i);
    i += h.length;
  }
  return out;
}

/** A frame with a valid header and a zero body: MPEG-1 Layer III 128 kbps 44.1 kHz (stereo or mono). */
function frame(opts: { mono?: boolean; rate32k?: boolean } = {}): Uint8Array {
  // 0x90: 128 kbps, 44.1 kHz; 0x98: 128 kbps, 32 kHz.
  const h = parseHeader(new Uint8Array([0xff, 0xfb, opts.rate32k ? 0x98 : 0x90, opts.mono ? 0xc0 : 0x00]), 0)!;
  const f = new Uint8Array(h.length);
  f.set([0xff, 0xfb, opts.rate32k ? 0x98 : 0x90, opts.mono ? 0xc0 : 0x00]);
  return f;
}

function join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("id3Length", () => {
  it("skips the whole tag: the fixture's audio starts after its 20 KB comment", () => {
    const tag = id3Length(FIXTURE);
    expect(tag).toBeGreaterThan(20_000);
    expect(parseHeader(FIXTURE, tag)).not.toBeNull();
    // The byte before is the tag's own padding, not a frame.
    expect(parseHeader(FIXTURE, tag - 1)).toBeNull();
  });

  it("is 0 without a tag, and counts a footer when the flag says so", () => {
    expect(id3Length(new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0, 0, 0]))).toBe(0);
    const tag = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0x10, 0, 0, 0x01, 0x00]); // size 128, footer
    expect(id3Length(tag)).toBe(10 + 128 + 10);
    // Synchsafe: each size byte carries 7 bits.
    expect(id3Length(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0x04, 0x7f, 0x7f]))).toBe(10 + (4 << 14) + (0x7f << 7) + 0x7f);
  });
});

describe("parseHeader", () => {
  it("reads the fixture's format (the Info frame is written wider than the audio after it)", () => {
    const info = parseHeader(FIXTURE, id3Length(FIXTURE))!;
    const h = parseHeader(FIXTURE, id3Length(FIXTURE) + info.length)!;
    expect(h).toMatchObject({ version: 2, layer: 3, bitrate: 16_000, sampleRate: 22_050, channels: 1, samples: 576 });
    expect(h.length).toBe(Math.floor((72 * 16_000) / 22_050));
    expect(info.bitrate).toBeGreaterThan(h.bitrate);
  });

  it("computes MPEG-1 Layer III lengths, with padding", () => {
    const h = parseHeader(new Uint8Array([0xff, 0xfb, 0x92, 0x00]), 0)!; // 128 kbps 44.1 kHz, padded
    expect(h.length).toBe(Math.floor((144 * 128_000) / 44_100) + 1);
    expect(h.samples).toBe(1152);
  });

  it("refuses what is not a header: free or bad bitrate, reserved rate, version or layer", () => {
    expect(parseHeader(new Uint8Array([0xff, 0xfb, 0x00, 0x00]), 0)).toBeNull(); // free format
    expect(parseHeader(new Uint8Array([0xff, 0xfb, 0xf0, 0x00]), 0)).toBeNull(); // bitrate 15
    expect(parseHeader(new Uint8Array([0xff, 0xfb, 0x9c, 0x00]), 0)).toBeNull(); // rate 3
    expect(parseHeader(new Uint8Array([0xff, 0xeb, 0x90, 0x00]), 0)).toBeNull(); // version 01
    expect(parseHeader(new Uint8Array([0xff, 0xf9, 0x90, 0x00]), 0)).toBeNull(); // layer 00
    expect(parseHeader(new Uint8Array([0xff, 0xfb, 0x90]), 0)).toBeNull(); // truncated
  });
});

describe("findSync", () => {
  const starts = frameStarts(FIXTURE);

  it("lands on a real frame boundary from any cut into the file", () => {
    expect(starts.length).toBeGreaterThan(1_000);
    for (const cut of [starts[3] + 1, starts[100] + 17, starts[700] - 1, starts[1200] + 30]) {
      const slice = FIXTURE.subarray(cut, cut + 4_000);
      const at = findSync(slice, 0);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(starts).toContain(cut + at);
      // The first boundary after the cut, not a later one.
      expect(starts.filter((s) => s >= cut && s < cut + at)).toEqual([]);
    }
  });

  it("is not fooled by a lone header-shaped word: it wants a second header where the first says", () => {
    const fake = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5]);
    const real = join(frame(), frame());
    const buf = join(fake, real);
    expect(findSync(buf, 0)).toBe(fake.length);
  });

  it("is -1 when there is no frame at all", () => {
    expect(findSync(new Uint8Array(500).fill(0x12), 0)).toBe(-1);
  });
});

describe("frameRun", () => {
  it("walks whole frames only, and stops before a partial one", () => {
    const f = frame();
    const buf = join(f, f, f, f.subarray(0, 100));
    expect(frameRun(buf, 0)).toMatchObject({ end: 3 * f.length, frames: 3 });
  });

  it("stops at a change of sample rate or channels, which a decoder refuses", () => {
    const a = frame();
    const rate = frame({ rate32k: true });
    const mono = frame({ mono: true });
    expect(frameRun(join(a, a, rate, rate), 0)).toMatchObject({ end: 2 * a.length, frames: 2 });
    expect(frameRun(join(a, mono, a), 0)).toMatchObject({ end: a.length, frames: 1 });
  });
});

describe("parseXing", () => {
  it("reads LAME's Info frame on the fixture: constant bitrate, its frame count", () => {
    const tag = id3Length(FIXTURE);
    const h = parseHeader(FIXTURE, tag)!;
    const x = parseXing(FIXTURE, tag, h)!;
    expect(x.vbr).toBe(false);
    // 45 s of 576-sample frames at 22,050 Hz, give or take the encoder's padding.
    expect(x.frames!).toBeGreaterThan(1_700);
    expect(x.frames!).toBeLessThan(1_750);
    // The second frame carries no tag.
    expect(parseXing(FIXTURE, tag + h.length, parseHeader(FIXTURE, tag + h.length)!)).toBeNull();
  });

  it("reads a VBR Xing tag's frames, bytes and table of contents", () => {
    const f = new Uint8Array(1_000);
    f.set([0xff, 0xfb, 0x90, 0x00]);
    const at = 4 + 32; // MPEG-1 stereo side info
    f.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 7], at); // "Xing", flags 1|2|4
    f.set([0, 0, 0x10, 0], at + 8); // frames 4096
    f.set([0, 1, 0, 0], at + 12); // bytes 65536
    for (let i = 0; i < 100; i++) f[at + 16 + i] = Math.round(i * 2.56);
    const x = parseXing(f, 0, parseHeader(f, 0)!)!;
    expect(x).toMatchObject({ vbr: true, frames: 4096, bytes: 65536 });
    expect(x.toc).toHaveLength(100);
    expect(x.toc![50]).toBe(128);
  });
});

describe("time and bytes", () => {
  it("a constant-bitrate file maps linearly, and back", () => {
    const map: StreamMap = { audioStart: 1000, audioBytes: 160_000, bitrate: 32_000 };
    expect(bytesPerSecond(map, 40)).toBe(4000);
    expect(timeToByte(map, 10, 40)).toBe(1000 + 40_000);
    expect(byteToTime(map, 41_000, 40)).toBeCloseTo(10, 6);
  });

  it("without a known size or duration, the header's bitrate is the rate", () => {
    const map: StreamMap = { audioStart: 500, bitrate: 16_000 };
    expect(timeToByte(map, 3, NaN)).toBe(500 + 6000);
    expect(byteToTime(map, 6500, NaN)).toBeCloseTo(3, 6);
  });

  it("a VBR table of contents is followed where the file is denser, and inverts", () => {
    // The first half of the time takes three quarters of the bytes.
    const toc = Array.from({ length: 100 }, (_, i) => (i < 50 ? Math.round((i / 50) * 192) : Math.round(192 + ((i - 50) / 50) * 64)));
    const map: StreamMap = { audioStart: 0, audioBytes: 256_000, toc, bitrate: 64_000 };
    expect(timeToByte(map, 50, 100)).toBe(192_000);
    expect(timeToByte(map, 25, 100)).toBe(96_000);
    expect(byteToTime(map, 192_000, 100)).toBeCloseTo(50, 1);
    expect(byteToTime(map, 96_000, 100)).toBeCloseTo(25, 1);
  });

  it("never maps a time before the audio", () => {
    const map: StreamMap = { audioStart: 2000, audioBytes: 10_000, bitrate: 8000 };
    expect(timeToByte(map, -5, 10)).toBe(2000);
    expect(byteToTime(map, 0, 10)).toBe(0);
  });
});
