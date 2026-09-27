// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as mirror from "../e2e-mirror.mjs";

/**
 * The e2e stack's /mirror (scripts/e2e-mirror.mjs): a valid, constant-bitrate
 * MP3 long enough for any show, served with the byte ranges a media element
 * asks for. That the browser plays it is proven by the tuned-in e2e specs,
 * which now play nothing else.
 */

const { FRAME, FRAME_BYTES, FIXTURE_BYTES, FIXTURE_SECONDS, fixtureBytes, serveFixtureMirror } = mirror as {
  FRAME: Buffer;
  FRAME_BYTES: number;
  FIXTURE_BYTES: number;
  FIXTURE_SECONDS: number;
  fixtureBytes: (a: number, b: number) => Buffer;
  serveFixtureMirror: (req: unknown, res: unknown) => void;
};

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => serveFixtureMirror(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mirror/archive%3Acoll%3Ashow.mp3`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("the fixture MP3", () => {
  it("is MPEG-1 Layer III, 32 kbps, 32 kHz, mono: 144-byte frames", () => {
    const [a, b, c, d] = FRAME;
    expect(a).toBe(0xff);
    expect(b & 0xe0).toBe(0xe0); // frame sync
    expect((b >> 3) & 0b11).toBe(0b11); // MPEG-1
    expect((b >> 1) & 0b11).toBe(0b01); // Layer III
    expect((c >> 4) & 0xf).toBe(0b0001); // 32 kbps
    expect((c >> 2) & 0b11).toBe(0b10); // 32 kHz
    expect((c >> 1) & 1).toBe(0); // no padding
    expect((d >> 6) & 0b11).toBe(0b11); // mono
    expect(FRAME_BYTES).toBe(Math.floor((144 * 32_000) / 32_000));
  });

  it("is longer than any show the station can start part-way into, at exactly its bitrate", () => {
    expect(FIXTURE_SECONDS).toBeGreaterThanOrEqual(4 * 3600);
    expect(FIXTURE_BYTES % FRAME_BYTES).toBe(0);
    expect((FIXTURE_BYTES * 8) / 32_000).toBeGreaterThanOrEqual(FIXTURE_SECONDS);
  });

  it("any byte range is the frame, repeated, from the right phase", () => {
    const whole = Buffer.concat([FRAME, FRAME, FRAME]);
    expect(fixtureBytes(0, 3 * FRAME_BYTES - 1).equals(whole)).toBe(true);
    expect(fixtureBytes(100, 300).equals(whole.subarray(100, 301))).toBe(true);
    const deep = FIXTURE_BYTES - 2 * FRAME_BYTES;
    expect(fixtureBytes(deep, deep + 3).equals(FRAME.subarray(0, 4))).toBe(true);
  });
});

describe("served like nginx serves a pinned episode", () => {
  it("200 with the length, audio/mpeg, byte ranges advertised, and CORS for the anonymous element", async () => {
    const res = await fetch(base, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(FIXTURE_BYTES));
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("206 for a range three hours in, with the bytes that belong there", async () => {
    const at = 3 * 3600 * 4000 + 17; // 4000 bytes a second
    const res = await fetch(base, { headers: { range: `bytes=${at}-${at + 999}` } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes ${at}-${at + 999}/${FIXTURE_BYTES}`);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(fixtureBytes(at, at + 999))).toBe(true);
  });

  it("an open range runs to the end; a suffix range is the tail; past the end is 416", async () => {
    const open = await fetch(base, { headers: { range: `bytes=${FIXTURE_BYTES - 10}-` } });
    expect(open.status).toBe(206);
    expect(Buffer.from(await open.arrayBuffer())).toHaveLength(10);
    const tail = await fetch(base, { headers: { range: "bytes=-5" } });
    expect(tail.headers.get("content-range")).toBe(`bytes ${FIXTURE_BYTES - 5}-${FIXTURE_BYTES - 1}/${FIXTURE_BYTES}`);
    await tail.arrayBuffer();
    const past = await fetch(base, { headers: { range: `bytes=${FIXTURE_BYTES}-` } });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe(`bytes */${FIXTURE_BYTES}`);
  });

  it("GET and HEAD only", async () => {
    expect((await fetch(base, { method: "POST" })).status).toBe(405);
  });
});
