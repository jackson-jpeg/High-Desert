/**
 * The level tap: real audio levels for the visualizers on iOS, without ever
 * touching the element that plays the show.
 *
 * Why it exists. On iOS the player's element is never routed through Web
 * Audio: `createMediaElementSource` takes the audio session off the element,
 * and playback stops on the lock screen and in the background (engine.ts).
 * So iOS had no analyser, every visualizer drew its idle frame, and the
 * now playing screen was a black box with dead VU needles (2026-10-12).
 *
 * What it does instead. While a visualizer is on screen, the page is visible,
 * the show is playing and its element has data in hand, the tap fetches the
 * bytes around the current position from the same URL the element is
 * playing (a Range request: this origin's /mirror, or archive.org, which
 * answers CORS on every hop), finds the first whole MPEG frame in them,
 * decodes that chunk off to the side (an OfflineAudioContext, which renders
 * to no device and opens no audio session) and serves the PCM at the
 * element's own currentTime through the AnalyserNode calls the visualizers
 * make. It never plays anything, never creates a media element, never
 * touches MediaSession, and fetches nothing while hidden, paused, buffering,
 * bridging between live shows, or with no visualizer mounted.
 *
 * The rules are pure functions here (shouldFetch, nextFetch) and the I/O is
 * injected (TapDeps), so src/audio/level-tap/__tests__/tap.test.ts can drive
 * every rule without a browser. src/audio/levels.ts wires it to the engine.
 */
import { byteToTime, bytesPerSecond, findSync, frameRun, id3Length, parseHeader, parseXing, timeToByte, type StreamMap } from "./mpeg";
import { FFT_SIZE, SpectrumState, timeDomainBytes } from "./spectrum";

/** Seconds of audio per chunk fetched. ~40 KB at the catalog's usual 32 kbps. */
export const CHUNK_SECONDS = 10;
/** Fetch the next chunk when less than this much is decoded ahead of the playhead. */
export const LEAD_SECONDS = 4;
/** First read of a file: enough for the ID3 header and, usually, the first frame. */
export const PROBE_BYTES = 16 * 1024;
/** The largest MPEG audio frame (layer 2/3 at 384 kbps, 32 kHz, padded) is 1,729 bytes; with room. */
const MAX_FRAME = 2_900;
/** How far before the wanted time a chunk's bytes start. */
const LEAD_IN_SECONDS = 0.25;
/** HAVE_FUTURE_DATA: the element is not starving, so a side fetch cannot slow it. */
const HAVE_FUTURE_DATA = 3;

/**
 * How long to wait after the `failures`-th failure in a row. archive.org's
 * storage nodes answer a share of Range requests with a bare 500 (and no CORS
 * header, so the browser reports a network error); `/download` names another
 * node on the next try, so the first few retries come quickly. A source that
 * keeps failing is left alone for longer and longer, up to 30 s.
 */
export function retryDelay(failures: number): number {
  if (failures <= 3) return 300;
  return Math.min(30_000, 2_000 * 2 ** (failures - 4));
}

/** What the tap reads of the player, read-only. */
export interface TapPlayer {
  src: string;
  t: number;
  duration: number;
  paused: boolean;
  readyState: number;
}

export interface Decoded {
  sampleRate: number;
  /** Mono PCM, -1..1. */
  data: Float32Array;
}

export interface TapDeps {
  player(): TapPlayer | null;
  /** The live station's station ID or quiet loop is on the element: not a show. */
  bridging(): boolean;
  visible(): boolean;
  fetch(url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<Response>;
  decode(bytes: ArrayBuffer): Promise<Decoded>;
  /** This page's origin, for "same origin". */
  origin: string;
  now(): number;
}

/** A URL the tap may read: this origin, or archive.org (CORS on every hop). Never blob:, data: or anything else. */
export function tapUrlAllowed(src: string, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(src, origin);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.origin === origin) return true;
  return u.protocol === "https:" && (u.hostname === "archive.org" || u.hostname.endsWith(".archive.org"));
}

export interface FetchConditions {
  retained: boolean;
  visible: boolean;
  playing: boolean;
  bridging: boolean;
  readyState: number;
  allowed: boolean;
}

/**
 * Whether the tap may use the network at all right now. Bandwidth only while
 * someone is looking at a meter, and never in competition with the show.
 */
export function shouldFetch(c: FetchConditions): boolean {
  return c.retained && c.visible && c.playing && !c.bridging && c.allowed && c.readyState >= HAVE_FUTURE_DATA;
}

export interface Segment {
  start: number;
  end: number;
  sampleRate: number;
  data: Float32Array;
}

/**
 * The decoded audio around `t`: how far it runs ahead of the playhead without
 * a gap, or null when nothing covers `t` at all. Chunks are fetched end to
 * end, but the byte map is an estimate, so a seam of up to a quarter second
 * still counts as continuous.
 */
export function coveredUntil(segments: readonly Segment[], t: number): number | null {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  let end: number | null = null;
  for (const s of sorted) {
    if (end === null) {
      if (s.start <= t && s.end > t) end = s.end;
    } else if (s.start <= end + 0.25 && s.end > end) {
      end = s.end;
    }
  }
  return end;
}

/**
 * Where the next chunk starts, or null when enough is decoded ahead. A seek,
 * a lock-screen return or a resume far from what is held all land in the
 * "nothing covers t" case and start again at the playhead.
 */
export function nextFetch(segments: readonly Segment[], t: number): number | null {
  const covered = coveredUntil(segments, t);
  if (covered === null) return t;
  if (covered - t >= LEAD_SECONDS) return null;
  return covered;
}

interface FileInfo {
  map: StreamMap;
  /** The file's length in bytes, when known. */
  total?: number;
}

type Probe = { state: "probing" } | { state: "ready"; info: FileInfo } | { state: "unusable" };

/** The total from `Content-Range: bytes a-b/total`, when the response lets a script read it. */
function rangeTotal(res: Response): number | undefined {
  const m = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "");
  return m ? Number(m[1]) : undefined;
}

/** Content-Length (CORS-safelisted, so readable from archive.org too). */
function contentLength(res: Response): number | undefined {
  const n = Number(res.headers.get("content-length"));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The most of a file's head the probe reads in one go: past this, the first frame is fetched on its own. */
export const PROBE_MAX = 256 * 1024;

/**
 * How much of a file's head the probe needs, given what it has so far: the
 * ID3 tag (often ~77 KB of cover art) plus room for the first frames, at
 * least PROBE_BYTES, at most PROBE_MAX.
 */
export function probeNeed(head: Uint8Array): number {
  if (head.length < 10) return PROBE_BYTES;
  return Math.min(PROBE_MAX, Math.max(PROBE_BYTES, id3Length(head) + 8192));
}

function concat(parts: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    const n = Math.min(p.length, length - at);
    out.set(p.subarray(0, n), at);
    at += n;
    if (at >= length) break;
  }
  return out;
}

/** Read a body until `need(bytesSoFar)` bytes are in hand, then cancel the rest of it. */
export async function readUntil(res: Response, need: (head: Uint8Array) => number): Promise<Uint8Array> {
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    return all.subarray(0, need(all));
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let have = 0;
  let head: Uint8Array = new Uint8Array(0);
  let limit = need(head);
  while (have < limit) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    parts.push(value);
    have += value.length;
    if (head.length < 10) {
      head = concat(parts, Math.min(have, 10));
      limit = need(head);
    }
  }
  reader.cancel().catch(() => {});
  return concat(parts, Math.min(have, limit));
}

export class LevelTap {
  readonly fftSize = FFT_SIZE;
  readonly frequencyBinCount = FFT_SIZE / 2;

  private retains = 0;
  private src: string | null = null;
  /**
   * Where the bytes actually came from last time: archive.org's /download
   * redirects to one storage node per request, and some nodes fail far more
   * than others (2026-10-12: one answered half its Range requests with a 500).
   * A node that answered is asked again; any failure goes back to the
   * show's own URL, which picks a node afresh.
   */
  private readUrl: string | null = null;
  private probe: Probe | null = null;
  private segments: Segment[] = [];
  private inflight: { controller: AbortController; from: number } | null = null;
  private backoffUntil = 0;
  private failures = 0;
  private readonly spectrum = new SpectrumState();
  private readonly window = new Float32Array(FFT_SIZE);
  private windowAt = NaN;

  constructor(private readonly deps: TapDeps) {}

  /** A visualizer is on screen. Returns its release. */
  retain(): () => void {
    this.retains++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retains--;
      if (this.retains <= 0) {
        this.retains = 0;
        this.halt();
      }
    };
  }

  /** Stop using the network now (hidden, paused, nothing on screen). What is decoded is kept. */
  halt(): void {
    this.inflight?.controller.abort();
    this.inflight = null;
  }

  /** Decoded audio held, for tests and the cap. */
  heldSegments(): readonly Segment[] {
    return this.segments;
  }

  /**
   * Whether the tap can stand in for an analyser for what is on the element
   * now: a show from a URL it may read, not the live station's bridge.
   * Advances the fetch state as a side effect; called once per drawn frame.
   */
  active(): boolean {
    const p = this.deps.player();
    if (!p || !p.src || this.deps.bridging() || !tapUrlAllowed(p.src, this.deps.origin)) {
      this.halt();
      return false;
    }
    this.pump(p);
    return true;
  }

  private pump(p: TapPlayer): void {
    if (p.src !== this.src) {
      // A show change, or the same show moved to the mirror: nothing held applies.
      this.halt();
      this.src = p.src;
      this.readUrl = null;
      this.probe = null;
      this.segments = [];
      this.failures = 0;
      this.backoffUntil = 0;
      this.spectrum.reset();
    }
    // Keep only what is near the playhead.
    this.segments = this.segments.filter((s) => s.end > p.t - 2 && s.start < p.t + 60);

    const ok = shouldFetch({
      retained: this.retains > 0,
      visible: this.deps.visible(),
      playing: !p.paused,
      bridging: this.deps.bridging(),
      readyState: p.readyState,
      allowed: true,
    });
    if (!ok) {
      this.halt();
      return;
    }
    if (this.probe?.state === "unusable") return;

    const from = this.probe?.state === "ready" ? nextFetch(this.segments, p.t) : null;
    if (this.inflight) {
      // A fetch for somewhere the playhead no longer is (a seek) is abandoned.
      const f = this.inflight.from;
      if (f >= 0 && (f > p.t + LEAD_SECONDS + CHUNK_SECONDS || f + CHUNK_SECONDS < p.t)) this.halt();
      else return;
    }
    if (this.deps.now() < this.backoffUntil) return;
    if (!this.probe) {
      void this.runProbe(p.src);
      return;
    }
    if (this.probe.state === "ready" && from !== null) void this.runChunk(p.src, this.probe.info, from);
  }

  private failed(): void {
    this.failures++;
    this.readUrl = null;
    this.backoffUntil = this.deps.now() + retryDelay(this.failures);
  }

  private async get(src: string, start: number, end: number | null, controller: AbortController): Promise<Response | null> {
    const url = this.readUrl ?? src;
    const res = await this.deps.fetch(url, { headers: { Range: `bytes=${start}-${end ?? ""}` }, signal: controller.signal });
    if (res.status === 206) {
      if (this.src === src && res.redirected && res.url && tapUrlAllowed(res.url, this.deps.origin)) this.readUrl = res.url;
      return res;
    }
    // Not a range. A server that ignores Range would send the whole
    // three-hour file: stop reading it, and never ask that URL again.
    res.body?.cancel().catch(() => {});
    if (res.status === 200 && this.src === src) this.probe = { state: "unusable" };
    return null;
  }

  private async runProbe(src: string): Promise<void> {
    const controller = new AbortController();
    this.inflight = { controller, from: -1 };
    this.probe = { state: "probing" };
    try {
      // Open-ended, read only as far as the probe needs: the 206's Content-Length
      // is then the whole file, which is how its size is learnt cross-origin
      // (archive.org exposes no headers, so Content-Range is unreadable).
      const res = await this.get(src, 0, null, controller);
      if (!res) {
        if (this.src === src && this.probe?.state === "probing") this.probe = null;
        if (this.src === src) this.failed();
        return;
      }
      const total = rangeTotal(res) ?? contentLength(res);
      const head = await readUntil(res, probeNeed);
      const tag = id3Length(head);
      let first = head.subarray(Math.min(tag, head.length));
      if (tag + 4096 > head.length) {
        const more = await this.get(src, tag, tag + 8191, controller);
        if (!more) throw new Error("no first frame");
        first = new Uint8Array(await more.arrayBuffer());
      }
      const i = findSync(first, 0);
      const h = i >= 0 ? parseHeader(first, i) : null;
      if (!h) throw new Error("no frame sync");
      const xing = parseXing(first, i, h);
      const audioStart = tag + i + (xing ? h.length : 0);
      // LAME writes its Info/Xing frame at whatever bitrate holds the tag; the
      // audio's own rate is the next frame's.
      const audioHeader = (xing && parseHeader(first, i + h.length)) || h;
      const known = total !== undefined ? total - audioStart : undefined;
      // A tag's byte count is believed only where nothing better exists or it
      // agrees: seven catalog files carry an Info tag for a shorter recording.
      const agrees = xing?.bytes !== undefined && (known === undefined || Math.abs(xing.bytes - known) < 0.05 * known);
      const audioBytes = known ?? (agrees ? xing!.bytes : undefined);
      const map: StreamMap = {
        audioStart,
        audioBytes,
        bitrate: audioHeader.bitrate,
        toc: xing?.vbr && agrees ? xing.toc : undefined,
      };
      if (this.src === src) {
        this.probe = { state: "ready", info: { map, total } };
        this.failures = 0;
      }
    } catch {
      if (this.src === src && this.probe?.state === "probing") {
        this.probe = null;
        // Halted (hidden, paused, a seek) is not a failure of the source.
        if (!controller.signal.aborted) this.failed();
      }
    } finally {
      if (this.inflight?.controller === controller) this.inflight = null;
    }
  }

  private async runChunk(src: string, info: FileInfo, from: number): Promise<void> {
    const controller = new AbortController();
    this.inflight = { controller, from };
    const player = this.deps.player();
    const duration = player?.duration ?? NaN;
    try {
      // A little before the time wanted: the first whole frame in the range
      // lies up to a frame after its first byte, and the chunk has to cover
      // `from` itself, or the playhead would sit just before it and ask again.
      const start = timeToByte(info.map, Math.max(0, from - LEAD_IN_SECONDS), duration);
      if (info.total !== undefined && start >= info.total) return;
      let end = start + Math.ceil(bytesPerSecond(info.map, duration) * CHUNK_SECONDS) + 2 * MAX_FRAME;
      if (info.total !== undefined) end = Math.min(end, info.total - 1);
      const res = await this.get(src, start, end, controller);
      if (!res) {
        if (this.src === src) this.failed();
        return;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const sync = findSync(bytes, 0);
      if (sync < 0) throw new Error("no frame sync");
      const run = frameRun(bytes, sync);
      if (run.frames < 2) throw new Error("no whole frames");
      const decoded = await this.deps.decode(bytes.slice(sync, run.end).buffer);
      if (this.src !== src || controller.signal.aborted) return;
      const t0 = byteToTime(info.map, start + sync, duration);
      this.segments.push({
        start: t0,
        end: t0 + decoded.data.length / decoded.sampleRate,
        sampleRate: decoded.sampleRate,
        data: decoded.data,
      });
      this.windowAt = NaN;
      this.failures = 0;
    } catch {
      if (this.src === src && !controller.signal.aborted) this.failed();
    } finally {
      if (this.inflight?.controller === controller) this.inflight = null;
    }
  }

  /** The FFT_SIZE samples that end at the playhead (zeros where nothing is decoded). */
  private fillWindow(): Float32Array {
    const p = this.deps.player();
    const t = p?.t ?? NaN;
    if (t === this.windowAt) return this.window;
    this.windowAt = t;
    const w = this.window;
    w.fill(0);
    if (!Number.isFinite(t)) return w;
    const seg = this.segments.filter((s) => s.start <= t && s.end > t).sort((a, b) => b.start - a.start)[0];
    if (!seg) return w;
    const endIdx = Math.floor((t - seg.start) * seg.sampleRate);
    for (let k = 0; k < FFT_SIZE; k++) {
      const idx = endIdx - FFT_SIZE + k;
      if (idx >= 0 && idx < seg.data.length) w[k] = seg.data[idx];
    }
    return w;
  }

  getFloatTimeDomainData(out: Float32Array): void {
    const w = this.fillWindow();
    const n = Math.min(out.length, FFT_SIZE);
    out.set(w.subarray(FFT_SIZE - n));
  }

  getByteTimeDomainData(out: Uint8Array): void {
    const w = this.fillWindow();
    const n = Math.min(out.length, FFT_SIZE);
    timeDomainBytes(w.subarray(FFT_SIZE - n), out);
  }

  getByteFrequencyData(out: Uint8Array): void {
    this.spectrum.frequencyBytes(this.fillWindow(), out);
  }
}
