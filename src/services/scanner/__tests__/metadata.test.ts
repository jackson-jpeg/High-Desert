// @vitest-environment node
import { describe, it, expect } from "vitest";
import { extractMetadata } from "../metadata";

/**
 * extractMetadata() against the real music-metadata, on a real (synthetic)
 * MP3: an ID3v2.3 tag carrying a title and artist, followed by genuine MPEG-1
 * Layer III frames. Nothing is mocked — the point is that the library swap
 * from music-metadata-browser to music-metadata v11 still yields tags, bitrate,
 * sample rate and duration from a File.
 *
 * This runs under Node, so it resolves music-metadata's `node` export; the
 * browser build resolves `default` (lib/core.js). Both export the same
 * `parseBlob` from the same core, and the production build bundling the
 * browser entry is exercised by `next build`.
 */

function id3Frame(id: string, text: string): Uint8Array {
  const body = new Uint8Array([0x00, ...new TextEncoder().encode(text)]); // 0x00 = ISO-8859-1
  const size = body.length;
  return new Uint8Array([
    ...new TextEncoder().encode(id),
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    0x00,
    0x00,
    ...body,
  ]);
}

function id3Tag(frames: Uint8Array[]): Uint8Array {
  const body = frames.reduce((acc, f) => new Uint8Array([...acc, ...f]), new Uint8Array());
  const n = body.length;
  // Tag size is a 28-bit synchsafe integer.
  const syncsafe = [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
  return new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, ...syncsafe, ...body]);
}

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding: 417-byte frames of 1152 samples. */
function mpegFrames(count: number): Uint8Array {
  const FRAME = 417;
  const out = new Uint8Array(FRAME * count);
  for (let i = 0; i < count; i++) {
    out.set([0xff, 0xfb, 0x90, 0x64], i * FRAME);
  }
  return out;
}

describe("extractMetadata", () => {
  it("reads ID3 tags and MPEG stream properties from a File", async () => {
    // 1000 frames * 1152 samples / 44100 Hz = 26.12 s
    const bytes = new Uint8Array([
      ...id3Tag([id3Frame("TIT2", "Open Lines"), id3Frame("TPE1", "Art Bell")]),
      ...mpegFrames(1000),
    ]);
    const file = new File([bytes], "1997-03-13 Open Lines.mp3", { type: "audio/mpeg" });

    const meta = await extractMetadata(file);

    expect(meta.title).toBe("Open Lines");
    expect(meta.artist).toBe("Art Bell");
    expect(meta.bitrate).toBe(128);
    expect(meta.sampleRate).toBe(44100);
    expect(meta.duration).toBe(26);
  });

  it("returns an empty object for a file that is not audio", async () => {
    const file = new File([new TextEncoder().encode("<html>not audio</html>")], "x.mp3", {
      type: "audio/mpeg",
    });
    const meta = await extractMetadata(file);
    expect(meta.title).toBeUndefined();
    expect(meta.duration).toBeUndefined();
  });
});
