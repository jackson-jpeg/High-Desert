import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The frame walker behind the catalog's duration corrections
 * (scripts/measure-duration.mjs, docs/ios-stalls.md). It is what replaced a
 * tag's word for a file's length with a count of the file's own frames, so it
 * is tested on bytes built here, frame by frame, with the answer known.
 */

const { createWalker, frameAt } = await import("../measure-duration.mjs");

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding: 417 bytes, 1152 samples. */
function frame(): Buffer {
  const b = Buffer.alloc(417, 0x55);
  b[0] = 0xff; b[1] = 0xfb; b[2] = 0x90; b[3] = 0x00;
  return b;
}
/** MPEG-2 Layer III, 64 kbps, 22.05 kHz: 208 bytes, 576 samples. */
function frame22(): Buffer {
  const b = Buffer.alloc(208, 0x55);
  b[0] = 0xff; b[1] = 0xf3; b[2] = 0x80; b[3] = 0x00;
  return b;
}
function id3(bodyBytes: number): Buffer {
  const h = Buffer.alloc(10 + bodyBytes, 0);
  h.write("ID3", 0, "latin1"); h[3] = 3;
  h[6] = (bodyBytes >> 21) & 0x7f; h[7] = (bodyBytes >> 14) & 0x7f; h[8] = (bodyBytes >> 7) & 0x7f; h[9] = bodyBytes & 0x7f;
  // Two chained fake frame headers inside the tag, as cover art can hold:
  // each "confirms" the other, so only skipping the tag keeps them out.
  if (bodyBytes > 1000) for (const at of [12, 12 + 417]) { h[at] = 0xff; h[at + 1] = 0xfb; h[at + 2] = 0x90; }
  return h;
}
function id3v1(): Buffer {
  const t = Buffer.alloc(128, 0x20);
  t.write("TAG", 0, "latin1");
  return t;
}
function walk(file: Buffer, chunk = file.length) {
  const w = createWalker();
  for (let i = 0; i < file.length; i += chunk) w.push(file.subarray(i, i + chunk));
  return w.end();
}

describe("frameAt", () => {
  it("reads a Layer III header's length and rate", () => {
    expect(frameAt(frame(), 0)).toMatchObject({ br: 128000, sr: 44100, spf: 1152, len: 417 });
    expect(frameAt(frame22(), 0)).toMatchObject({ br: 64000, sr: 22050, spf: 576, len: 208 });
    expect(frameAt(Buffer.from([0xff, 0xfb, 0xf0, 0]), 0)).toBeNull(); // bitrate index 15
  });
});

describe("the walker counts the file, not a tag", () => {
  const N = 1000;
  const body = Buffer.concat(Array.from({ length: N }, frame));
  const file = Buffer.concat([id3(4000), body, id3v1()]);
  const seconds = Math.round(((N * 1152) / 44100) * 100) / 100;

  it("every frame, past an ID3v2 tag holding a false sync word, before an ID3v1 tag", () => {
    expect(walk(file)).toEqual({ frames: N, seconds, audioBytes: N * 417, resyncs: 0, bitrates: [128], sampleRates: [44100] });
  });

  it("the same answer however the stream is chunked", () => {
    for (const chunk of [1, 7, 416, 417, 418, 4096]) expect(walk(file, chunk), `chunk ${chunk}`).toEqual(walk(file));
  });

  it("two recordings joined: frames of both, both rates, the junk between them as one resync", () => {
    const joined = Buffer.concat([id3(100), body, Buffer.alloc(333, 0x00), ...Array.from({ length: 500 }, frame22)]);
    const r = walk(joined, 999);
    expect(r.frames).toBe(N + 500);
    expect(r.seconds).toBe(Math.round(((N * 1152) / 44100 + (500 * 576) / 22050) * 100) / 100);
    expect(r.resyncs).toBe(1);
    expect(r.bitrates).toEqual([64, 128]);
    expect(r.sampleRates).toEqual([22050, 44100]);
  });

  it("a partial frame at the end is not counted", () => {
    const cut = Buffer.concat([body, frame().subarray(0, 200)]);
    expect(walk(cut).frames).toBe(N);
  });
});

describe("the catalog carries the measured durations (data/duration-corrections.json)", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const { corrections } = JSON.parse(readFileSync(path.join(ROOT, "data/duration-corrections.json"), "utf8")) as {
    corrections: { fileHash: string; was: number; measured: number; frames: number; bitrateKbps: number; sampleRate: number }[];
  };
  const catalog = new Map(
    (JSON.parse(readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8")) as { fileHash: string; duration: number }[])
      .map((e) => [e.fileHash, e]),
  );

  it("every corrected row has its measured runtime, never the tag's", () => {
    expect(corrections.length).toBe(7);
    for (const c of corrections) expect(catalog.get(c.fileHash)?.duration, c.fileHash).toBe(c.measured);
  });

  it("each measurement is a frame count at the file's own rate, and longer than the tag said", () => {
    for (const c of corrections) {
      const spf = c.sampleRate >= 32000 ? 1152 : 576;
      expect(Math.abs((c.frames * spf) / c.sampleRate - c.measured), c.fileHash).toBeLessThan(0.01);
      expect(c.measured, c.fileHash).toBeGreaterThan(c.was);
    }
  });
});
