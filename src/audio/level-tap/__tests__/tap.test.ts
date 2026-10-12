/**
 * The level tap's rules, driven through the real LevelTap with its I/O
 * faked: a server that answers Range requests from the committed meter
 * fixture (looped to 15 minutes, as e2e/meters.spec.ts serves it), and a
 * decoder that returns a ramp, so where each sample came from is checkable.
 *
 * What is held: when the tap may use the network at all, that it starts at
 * the playhead's byte past the ID3 tag, that the PCM it serves is the PCM at
 * the element's currentTime, that it reads ahead and no further, and that a
 * seek, a show change, a hidden page, a pause, an unmount and a hostile
 * server each do what the comments in tap.ts say.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { id3Length, parseHeader } from "../mpeg";
import {
  CHUNK_SECONDS,
  LEAD_SECONDS,
  LevelTap,
  coveredUntil,
  nextFetch,
  probeNeed,
  retryDelay,
  shouldFetch,
  tapUrlAllowed,
  type Segment,
  type TapPlayer,
} from "../tap";

const ORIGIN = "https://highdesert.space";
const ARCHIVE = "https://archive.org/download/coll/show.mp3";
const NODE = "https://ia800100.us.archive.org/0/items/coll/show.mp3";
const MIRROR = `${ORIGIN}/mirror/archive%3Acoll%3Ashow.mp3`;

const RAW = new Uint8Array(readFileSync(path.join(process.cwd(), "e2e/assets/meter-tone.mp3")));
const TAG = id3Length(RAW);
const INFO = parseHeader(RAW, TAG)!;
const AUDIO = RAW.subarray(TAG + INFO.length);
/** Tag, then the audio 20 times: 900 s of 16 kbps, constant bitrate, no Info frame. */
const FILE = (() => {
  const out = new Uint8Array(TAG + AUDIO.length * 20);
  out.set(RAW.subarray(0, TAG));
  for (let i = 0; i < 20; i++) out.set(AUDIO, TAG + i * AUDIO.length);
  return out;
})();
const DURATION = 900;
const BYTES_PER_SECOND = (FILE.length - TAG) / DURATION;
const RATE = 44_100;

interface Call {
  url: string;
  range: string;
  signal: AbortSignal;
}

interface Harness {
  tap: LevelTap;
  player: TapPlayer;
  calls: Call[];
  env: { visible: boolean; bridging: boolean; now: number };
  server: {
    ignoreRange: boolean;
    /** Answer a request to the show's archive.org URL as if redirected to a node. */
    redirect: boolean;
    /** Requests matching this never answer (a fetch in flight). */
    hang: (c: Call) => boolean;
    /** Requests matching this fail as CORS-less 500s do: a network error. */
    fail: (c: Call) => boolean;
  };
}

function harness(src: string): Harness {
  const calls: Call[] = [];
  const env = { visible: true, bridging: false, now: 1_000_000 };
  const server = { ignoreRange: false, redirect: false, hang: (_c: Call) => false, fail: (_c: Call) => false };
  const player: TapPlayer = { src, t: 0, duration: DURATION, paused: false, readyState: 4 };
  const tap = new LevelTap({
    player: () => player,
    bridging: () => env.bridging,
    visible: () => env.visible,
    origin: ORIGIN,
    now: () => env.now,
    fetch: (url, init) => {
      const call = { url, range: init.headers.Range, signal: init.signal };
      calls.push(call);
      if (server.hang(call)) return new Promise<Response>(() => {});
      if (server.fail(call)) return Promise.reject(new TypeError("Failed to fetch"));
      if (server.ignoreRange) return Promise.resolve(new Response(FILE.slice(), { status: 200 }));
      const m = /^bytes=(\d+)-(\d*)$/.exec(call.range)!;
      const start = Number(m[1]);
      const end = m[2] === "" ? FILE.length - 1 : Math.min(Number(m[2]), FILE.length - 1);
      const sameOrigin = new URL(url).origin === ORIGIN;
      const headers: Record<string, string> = { "content-length": String(end - start + 1) };
      // archive.org exposes no headers: Content-Range is unreadable cross-origin.
      if (sameOrigin) headers["content-range"] = `bytes ${start}-${end}/${FILE.length}`;
      const res = new Response(FILE.slice(start, end + 1), { status: 206, headers });
      if (server.redirect && url === ARCHIVE) {
        Object.defineProperty(res, "redirected", { value: true });
        Object.defineProperty(res, "url", { value: NODE });
      }
      return Promise.resolve(res);
    },
    // A ramp per chunk: sample i of n is i / n, at the decoder's 44.1 kHz.
    decode: async (bytes) => {
      const n = Math.round((bytes.byteLength / BYTES_PER_SECOND) * RATE);
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = i / n;
      return { sampleRate: RATE, data };
    },
  });
  return { tap, player, calls, env, server };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Drive frames until nothing more happens. */
async function frames(h: Harness, n = 4) {
  for (let i = 0; i < n; i++) {
    h.tap.active();
    await settle();
  }
}

const rangeStart = (c: Call) => Number(/^bytes=(\d+)-/.exec(c.range)![1]);

let releases: (() => void)[] = [];
afterEach(() => {
  releases.forEach((r) => r());
  releases = [];
});
function retained(src: string): Harness {
  const h = harness(src);
  releases.push(h.tap.retain());
  return h;
}

describe("when the tap may use the network", () => {
  const all = { retained: true, visible: true, playing: true, bridging: false, readyState: 4, allowed: true };

  it("only with a visualizer mounted, the page visible, the show playing with data in hand, not bridging", () => {
    expect(shouldFetch(all)).toBe(true);
    expect(shouldFetch({ ...all, retained: false })).toBe(false);
    expect(shouldFetch({ ...all, visible: false })).toBe(false);
    expect(shouldFetch({ ...all, playing: false })).toBe(false);
    expect(shouldFetch({ ...all, bridging: true })).toBe(false);
    expect(shouldFetch({ ...all, allowed: false })).toBe(false);
    // HAVE_CURRENT_DATA: the element is starving; the show comes first.
    expect(shouldFetch({ ...all, readyState: 2 })).toBe(false);
    expect(shouldFetch({ ...all, readyState: 3 })).toBe(true);
  });

  it("only from this origin or archive.org over https: never a local file", () => {
    expect(tapUrlAllowed(MIRROR, ORIGIN)).toBe(true);
    expect(tapUrlAllowed(ARCHIVE, ORIGIN)).toBe(true);
    expect(tapUrlAllowed(NODE, ORIGIN)).toBe(true);
    expect(tapUrlAllowed("https://dn720703.ca.archive.org/0/items/x.mp3", ORIGIN)).toBe(true);
    expect(tapUrlAllowed("http://archive.org/download/x.mp3", ORIGIN)).toBe(false);
    expect(tapUrlAllowed("https://archive.org.evil.example/x.mp3", ORIGIN)).toBe(false);
    expect(tapUrlAllowed("https://example.com/x.mp3", ORIGIN)).toBe(false);
    expect(tapUrlAllowed("blob:https://highdesert.space/abc", ORIGIN)).toBe(false);
    expect(tapUrlAllowed("data:audio/mpeg;base64,AAAA", ORIGIN)).toBe(false);
  });

  it("each condition, through the real tap: nothing is fetched while it is false", async () => {
    const cases: [string, (h: Harness) => void][] = [
      ["paused", (h) => (h.player.paused = true)],
      ["hidden", (h) => (h.env.visible = false)],
      ["bridging", (h) => (h.env.bridging = true)],
      ["buffering", (h) => (h.player.readyState = 2)],
      ["a local file", (h) => (h.player.src = "blob:https://highdesert.space/abc")],
    ];
    for (const [, block] of cases) {
      const h = retained(MIRROR);
      block(h);
      await frames(h);
      expect(h.calls).toEqual([]);
    }
    const unmounted = harness(MIRROR);
    await frames(unmounted);
    expect(unmounted.calls).toEqual([]);
    // Control: the same tap with nothing blocking does fetch.
    const h = retained(MIRROR);
    await frames(h);
    expect(h.calls.length).toBeGreaterThan(0);
  });

  it("is not a source during the live station's bridge, or for a local file", () => {
    const h = retained(MIRROR);
    expect(h.tap.active()).toBe(true);
    h.env.bridging = true;
    expect(h.tap.active()).toBe(false);
    h.env.bridging = false;
    h.player.src = "blob:https://highdesert.space/abc";
    expect(h.tap.active()).toBe(false);
  });
});

describe("reading the show's own bytes", () => {
  it("probes the head of the file once, past a tag bigger than one read", async () => {
    expect(probeNeed(FILE.subarray(0, 10))).toBe(TAG + 8192);
    expect(probeNeed(new Uint8Array([0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0]))).toBe(16 * 1024);
    const h = retained(MIRROR);
    h.player.t = 300;
    await frames(h);
    expect(h.calls[0].range).toBe("bytes=0-");
    expect(h.calls.filter((c) => c.range === "bytes=0-")).toHaveLength(1);
  });

  it("starts the first chunk at the playhead's byte, cross-origin too (size from Content-Length)", async () => {
    for (const src of [MIRROR, ARCHIVE]) {
      const h = retained(src);
      h.player.t = 300;
      await frames(h);
      const chunk = h.calls[1];
      // A quarter second early, so the first whole frame still covers 300 s.
      const expected = TAG + 299.75 * BYTES_PER_SECOND;
      expect(Math.abs(rangeStart(chunk) - expected)).toBeLessThan(60);
      const seg = h.tap.heldSegments()[0];
      expect(seg.start).toBeLessThanOrEqual(300);
      expect(seg.start).toBeGreaterThan(299.7);
      expect(seg.end - seg.start).toBeGreaterThan(CHUNK_SECONDS - 0.5);
    }
  });

  it("serves the samples at the element's currentTime", async () => {
    const h = retained(MIRROR);
    h.player.t = 120;
    await frames(h);
    const seg = h.tap.heldSegments()[0];
    for (const t of [121, 124.5, 127]) {
      h.player.t = t;
      const out = new Float32Array(2048);
      h.tap.getFloatTimeDomainData(out);
      const end = Math.floor((t - seg.start) * seg.sampleRate);
      expect(out[2047]).toBeCloseTo(seg.data[end - 1], 6);
      expect(out[0]).toBeCloseTo(seg.data[end - 2048], 6);
      const bytes = new Uint8Array(1024);
      h.tap.getByteTimeDomainData(bytes);
      expect(bytes[1023]).toBe(Math.min(255, Math.floor(128 * (1 + seg.data[end - 1]))));
    }
  });

  it("is silent (128) where nothing is decoded, never stale audio", async () => {
    const h = retained(MIRROR);
    h.player.t = 50;
    await frames(h);
    h.player.t = 500;
    const bytes = new Uint8Array(1024);
    h.tap.getByteTimeDomainData(bytes);
    expect(new Set(bytes)).toEqual(new Set([128]));
  });

  it("reads ahead before the decoded audio runs out, and no further", async () => {
    const h = retained(MIRROR);
    h.player.t = 60;
    await frames(h);
    const seg = h.tap.heldSegments()[0];
    const n = h.calls.length;
    h.player.t = seg.end - LEAD_SECONDS - 1;
    await frames(h);
    expect(h.calls.length).toBe(n);
    h.player.t = seg.end - LEAD_SECONDS + 1;
    await frames(h, 1);
    expect(h.calls.length).toBe(n + 1);
    const next = h.calls[n];
    expect(Math.abs(rangeStart(next) - (TAG + (seg.end - 0.25) * BYTES_PER_SECOND))).toBeLessThan(60);
  });
});

describe("resync", () => {
  it("a seek far away abandons the fetch in flight and starts at the new playhead", async () => {
    const h = retained(MIRROR);
    h.player.t = 60;
    await frames(h, 1); // probe
    h.server.hang = (c) => c.range !== "bytes=0-";
    await frames(h, 1);
    const stuck = h.calls[h.calls.length - 1];
    expect(stuck.signal.aborted).toBe(false);
    h.player.t = 600;
    h.server.hang = () => false;
    await frames(h);
    expect(stuck.signal.aborted).toBe(true);
    expect(Math.abs(rangeStart(h.calls[h.calls.length - 1]) - (TAG + 599.75 * BYTES_PER_SECOND))).toBeLessThan(60);
    expect(coveredUntil(h.tap.heldSegments(), 600)).not.toBeNull();
  });

  it("a show change, or the same show moving to the mirror, drops everything held", async () => {
    const h = retained(ARCHIVE);
    h.player.t = 100;
    await frames(h);
    expect(h.tap.heldSegments().length).toBe(1);
    h.player.src = MIRROR;
    const before = h.calls.length;
    h.tap.active();
    expect(h.tap.heldSegments()).toEqual([]);
    await frames(h);
    expect(h.calls[before]).toMatchObject({ url: MIRROR, range: "bytes=0-" });
    expect(coveredUntil(h.tap.heldSegments(), 100)).not.toBeNull();
  });

  it("hidden (the lock screen) or paused stops the fetch in flight; back on screen it starts where the playhead is", async () => {
    for (const block of [(h: Harness) => (h.env.visible = false), (h: Harness) => (h.player.paused = true)]) {
      const h = retained(MIRROR);
      h.player.t = 60;
      await frames(h, 1);
      h.server.hang = (c) => c.range !== "bytes=0-";
      await frames(h, 1);
      const inflight = h.calls[h.calls.length - 1];
      block(h);
      h.tap.active();
      expect(inflight.signal.aborted).toBe(true);
      const n = h.calls.length;
      await frames(h);
      expect(h.calls.length).toBe(n);
      // The show played on while the screen was off.
      h.env.visible = true;
      h.player.paused = false;
      h.server.hang = () => false;
      h.player.t = 240;
      await frames(h);
      expect(coveredUntil(h.tap.heldSegments(), 240)).not.toBeNull();
    }
  });

  it("the last visualizer unmounting stops the fetch in flight", async () => {
    const h = harness(MIRROR);
    const a = h.tap.retain();
    const b = h.tap.retain();
    h.server.hang = () => true;
    await frames(h, 1);
    const inflight = h.calls[0];
    a();
    expect(inflight.signal.aborted).toBe(false);
    b();
    expect(inflight.signal.aborted).toBe(true);
  });
});

describe("hostile and flaky servers", () => {
  it("a server that ignores Range is never asked again", async () => {
    const h = retained(MIRROR);
    h.server.ignoreRange = true;
    await frames(h, 6);
    h.env.now += 120_000;
    await frames(h, 6);
    expect(h.calls).toHaveLength(1);
  });

  it("archive.org's node that answered is asked again; after a failure, the show's own URL", async () => {
    const h = retained(ARCHIVE);
    h.server.redirect = true;
    h.player.t = 30;
    await frames(h);
    expect(h.calls[0].url).toBe(ARCHIVE);
    expect(h.calls[1].url).toBe(NODE);
    h.server.fail = (c) => c.url === NODE;
    h.player.t = 200;
    await frames(h, 1);
    expect(h.calls[h.calls.length - 1].url).toBe(NODE);
    const failedAt = h.calls.length;
    h.server.fail = () => false;
    h.env.now += retryDelay(1);
    await frames(h);
    expect(h.calls[failedAt].url).toBe(ARCHIVE);
  });

  it("backs off after failures: quick at first (another node), then longer", async () => {
    expect([1, 2, 3].map(retryDelay)).toEqual([300, 300, 300]);
    expect(retryDelay(4)).toBe(2_000);
    expect(retryDelay(5)).toBe(4_000);
    expect(retryDelay(20)).toBe(30_000);
    const h = retained(ARCHIVE);
    h.server.fail = () => true;
    await frames(h, 3);
    expect(h.calls).toHaveLength(1);
    h.env.now += 299;
    await frames(h, 2);
    expect(h.calls).toHaveLength(1);
    h.env.now += 2;
    await frames(h, 1);
    expect(h.calls).toHaveLength(2);
  });
});

describe("coverage", () => {
  const seg = (start: number, end: number): Segment => ({ start, end, sampleRate: RATE, data: new Float32Array(0) });

  it("runs across chunks that meet, within a quarter second", () => {
    expect(coveredUntil([seg(0, 10), seg(10.2, 20)], 5)).toBe(20);
    expect(coveredUntil([seg(10.5, 20), seg(0, 10)], 5)).toBe(10);
    expect(coveredUntil([seg(0, 10)], 12)).toBeNull();
  });

  it("asks for the playhead when nothing covers it, the covered end when it runs short", () => {
    expect(nextFetch([], 42)).toBe(42);
    expect(nextFetch([seg(40, 50)], 42)).toBeNull();
    expect(nextFetch([seg(40, 50)], 47)).toBe(50);
  });
});
