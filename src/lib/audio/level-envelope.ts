/**
 * Two-pass Level: a show's gain envelope, computed once on the server from the
 * whole file and applied in the browser as a GainNode curve
 * (docs/audio-processing/README.md, "Two-pass Level").
 *
 * The live leveler knows only the past, so it had to choose between letting a
 * talker change through (the swing misses) and pumping the pauses (the pause
 * misses). A file is fixed: the server listens to all of it once, and the
 * gain for every tenth of a second is decided with the talk on both sides in
 * view. No lookahead at playback, so no delay, and the station stays in sync.
 *
 * `gainEnvelope` is an exact port of `gain_envelope` in Jackson's prototype
 * (envelope.py, 2026-11-16), with the parameters he chose: target -18 LUFS,
 * sigma 0.8 s, pause hold 3 s, slew 24 dB/s, +18 / -12 dB. Its input is
 * momentary loudness (BS.1770, 400 ms) every 100 ms; frame i is centred at
 * ENVELOPE_OFFSET_SEC + i * ENVELOPE_HOP_SEC of the file. Pure: the server job,
 * the browser and the tests all use it.
 *
 * Stored as int8 in 0.25 dB steps (`encodeEnvelope`), 10 values a second:
 * about 81 KB for a 2.25 hour show, metadata only.
 */

export const ENVELOPE_HOP_SEC = 0.1;
/** Frame 0's centre: the first 400 ms window is [0, 0.4]. */
export const ENVELOPE_OFFSET_SEC = 0.2;
/** Bump when the algorithm or its parameters change: older envelopes are rebuilt. */
export const ENVELOPE_VERSION = 1;
export const ENVELOPE_STEP_DB = 0.25;

export const ENVELOPE_PARAMS = {
  target: -18,
  sigmaS: 0.8,
  maxBoost: 18,
  maxCut: 12,
  smoothS: 0.25,
  holdS: 3,
  maxSlew: 24,
} as const;

export type EnvelopeParams = { -readonly [K in keyof typeof ENVELOPE_PARAMS]: number };

/** numpy.percentile, linear interpolation. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const s = Array.from(values).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const r = (p / 100) * (s.length - 1);
  const lo = Math.floor(r);
  const hi = Math.ceil(r);
  return s[lo] + (s[hi] - s[lo]) * (r - lo);
}

/** Frames within 20 dB of the clip's loud end (its 95th percentile), and above -60. */
export function talkMask(L: ArrayLike<number>): Uint8Array {
  const top = percentile(L, 95);
  const m = new Uint8Array(L.length);
  for (let i = 0; i < L.length; i++) m[i] = L[i] > top - 20 && L[i] > -60 ? 1 : 0;
  return m;
}

/** scipy.ndimage.gaussian_filter1d, mode "nearest", truncate 4. */
export function gaussian(x: ArrayLike<number>, sigma: number): Float64Array {
  const radius = Math.trunc(4 * sigma + 0.5);
  const w = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp((-0.5 * k * k) / (sigma * sigma));
    w[k + radius] = v;
    sum += v;
  }
  for (let k = 0; k < w.length; k++) w[k] /= sum;
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      acc += w[k + radius] * x[j];
    }
    out[i] = acc;
  }
  return out;
}

/** scipy.ndimage.minimum_filter1d, mode "nearest", origin 0 (an even size leans left). */
export function minimumFilter(x: ArrayLike<number>, size: number): Float64Array {
  const n = x.length;
  const lo = Math.floor(size / 2);
  const hi = size - lo - 1;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = i - lo; j <= i + hi; j++) {
      const v = x[Math.min(n - 1, Math.max(0, j))];
      if (v < m) m = v;
    }
    out[i] = m;
  }
  return out;
}

/** Forward and backward slew limits, averaged, then once more forward. */
export function slewLimit(g: ArrayLike<number>, step: number): Float64Array {
  const n = g.length;
  const f = Float64Array.from(g);
  for (let i = 1; i < n; i++) f[i] = Math.min(f[i - 1] + step, Math.max(f[i - 1] - step, f[i]));
  const b = Float64Array.from(g);
  for (let i = n - 2; i >= 0; i--) b[i] = Math.min(b[i + 1] + step, Math.max(b[i + 1] - step, b[i]));
  const m = new Float64Array(n);
  for (let i = 0; i < n; i++) m[i] = (f[i] + b[i]) / 2;
  for (let i = 1; i < n; i++) m[i] = Math.min(m[i - 1] + step, Math.max(m[i - 1] - step, m[i]));
  return m;
}

/**
 * The gain envelope (dB per frame) from momentary loudness `L` (LUFS per
 * 100 ms frame). See the module comment; each step is the prototype's.
 */
export function gainEnvelope(L: ArrayLike<number>, p: EnvelopeParams = { ...ENVELOPE_PARAMS }): Float64Array {
  const HOP = ENVELOPE_HOP_SEC;
  const n = L.length;
  if (!n) return new Float64Array(0);
  const talk = talkMask(L);
  const num = new Float64Array(n);
  for (let i = 0; i < n; i++) num[i] = Math.pow(10, L[i] / 10) * talk[i];
  const sig = p.sigmaS / HOP;
  // Talk-weighted local loudness: pauses never pull the estimate down.
  const gn = gaussian(num, sig);
  const gd = gaussian(talk, sig);
  const local = new Float64Array(n);
  const ok: number[] = [];
  for (let i = 0; i < n; i++) {
    if (gd[i] > 0.05) {
      local[i] = 10 * Math.log10(gn[i] / Math.max(gd[i], 1e-9) + 1e-12);
      ok.push(i);
    } else local[i] = NaN;
  }
  if (!ok.length) return new Float64Array(n);
  // Through long silences, hold the neighbouring talk level (numpy.interp).
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(local[i])) continue;
    while (k < ok.length && ok[k] < i) k++;
    if (k === 0) local[i] = local[ok[0]];
    else if (k >= ok.length) local[i] = local[ok[ok.length - 1]];
    else {
      const a = ok[k - 1];
      const b = ok[k];
      local[i] = local[a] + ((local[b] - local[a]) * (i - a)) / (b - a);
    }
  }
  let g: Float64Array = new Float64Array(n);
  for (let i = 0; i < n; i++) g[i] = Math.min(p.maxBoost, Math.max(-p.maxCut, p.target - local[i]));
  g = gaussian(g, p.smoothS / HOP);
  // Pause hold: in a pause, never above the lowest gain within holdS, so room
  // noise and hiss are never raised past the talk around them.
  const gmin = minimumFilter(g, Math.trunc(p.holdS / HOP) + 1);
  for (let i = 0; i < n; i++) if (!talk[i]) g[i] = Math.min(g[i], gmin[i]);
  g = gaussian(g, 0.08 / HOP);
  if (p.maxSlew) g = slewLimit(g, p.maxSlew * HOP);
  return g;
}

/**
 * Our steps after the prototype (2026-11-16, not in envelope.py), each of
 * which can only lower the gain, so peaks and pauses only improve and the
 * slew limit still holds.
 *
 * The gap after a talker. A gap of 0.25 to 0.65 s is too short for 400 ms
 * frames to read as a pause, so the prototype's pause hold never sees it,
 * and its gain kept moving through it towards the next talker: up to 1.7 dB
 * into the gap against the 1 dB target (worst-2001-09-11, hiss-2000-03-31b).
 *
 * - `holdDips`: where the loudness dips `dipDb` below the loudest frame
 *   within half a second either side, the gain may not rise; once the talk
 *   is back it catches up at the slew limit.
 * - `delayRises`: each frame takes the lowest gain of the last `riseDelayS`,
 *   so a cut still starts before a loud caller while a lift waits for the
 *   quieter talker.
 *
 * Chosen on the 34 clips (2026-11-16): the hold alone left worst-2001-09-11
 * at +1.10 dB; with a 0.5 s delay hiss-2001-02-14's swing ratio missed
 * (0.55); 0.2 s left +1.05 dB; 0.3 s passes every clip (that swing at 0.50,
 * the line itself).
 */
export const LEVEL_EXTRAS = { dipDb: 8, riseDelayS: 0.3 };

export function holdDips(g: ArrayLike<number>, L: ArrayLike<number>, dipDb = LEVEL_EXTRAS.dipDb, maxSlew = ENVELOPE_PARAMS.maxSlew): Float64Array {
  const n = g.length;
  const out = new Float64Array(n);
  const R = Math.round(0.5 / ENVELOPE_HOP_SEC);
  const step = maxSlew * ENVELOPE_HOP_SEC;
  for (let i = 0; i < n; i++) {
    let top = -Infinity;
    for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) if (L[j] > top) top = L[j];
    const dip = dipDb > 0 && L[i] < top - dipDb;
    out[i] = i === 0 ? g[i] : Math.min(g[i], dip ? out[i - 1] : out[i - 1] + step);
  }
  return out;
}

export function delayRises(g: ArrayLike<number>, riseDelayS = LEVEL_EXTRAS.riseDelayS): Float64Array {
  const D = Math.round(riseDelayS / ENVELOPE_HOP_SEC);
  const out = new Float64Array(g.length);
  for (let i = 0; i < g.length; i++) {
    let m = g[i];
    for (let j = Math.max(0, i - D); j < i; j++) if (g[j] < m) m = g[j];
    out[i] = m;
  }
  return out;
}

/** What the server stores and the browser plays: the prototype's envelope, then our steps. */
export function levelEnvelope(L: ArrayLike<number>): Float64Array {
  return holdDips(delayRises(gainEnvelope(L)), L);
}

/** dB per frame → int8, 0.25 dB steps (the clamp keeps every value in range). */
export function encodeEnvelope(g: ArrayLike<number>): Int8Array {
  const out = new Int8Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = Math.max(-128, Math.min(127, Math.round(g[i] / ENVELOPE_STEP_DB)));
  return out;
}

export function decodeEnvelope(q: ArrayLike<number>): Float32Array {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] * ENVELOPE_STEP_DB;
  return out;
}

/**
 * The wire format of `GET /api/level/envelope`: "HDE" + version byte, then
 * hop and offset in ms (uint16, little-endian), then the int8 values.
 */
export const ENVELOPE_MAGIC = [0x48, 0x44, 0x45];
export const ENVELOPE_HEADER = 8;

export function packEnvelope(q: Int8Array, version = ENVELOPE_VERSION): Uint8Array {
  const out = new Uint8Array(ENVELOPE_HEADER + q.length);
  out.set(ENVELOPE_MAGIC, 0);
  out[3] = version;
  const dv = new DataView(out.buffer);
  dv.setUint16(4, Math.round(ENVELOPE_HOP_SEC * 1000), true);
  dv.setUint16(6, Math.round(ENVELOPE_OFFSET_SEC * 1000), true);
  out.set(new Uint8Array(q.buffer, q.byteOffset, q.length), ENVELOPE_HEADER);
  return out;
}

export interface Envelope {
  version: number;
  hopSec: number;
  offsetSec: number;
  /** dB per frame. */
  gainDb: Float32Array;
}

/** null for anything that is not a well-formed envelope. */
export function unpackEnvelope(buf: ArrayBuffer | Uint8Array): Envelope | null {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length <= ENVELOPE_HEADER) return null;
  if (b[0] !== ENVELOPE_MAGIC[0] || b[1] !== ENVELOPE_MAGIC[1] || b[2] !== ENVELOPE_MAGIC[2]) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.length);
  const hop = dv.getUint16(4, true);
  if (!hop) return null;
  const q = new Int8Array(b.buffer, b.byteOffset + ENVELOPE_HEADER, b.length - ENVELOPE_HEADER);
  return { version: b[3], hopSec: hop / 1000, offsetSec: dv.getUint16(6, true) / 1000, gainDb: decodeEnvelope(q) };
}

/** The gain (dB) at file time `t`, linear between frames, held at both ends. */
export function gainAt(e: Envelope, t: number): number {
  const g = e.gainDb;
  if (!g.length) return 0;
  const x = (t - e.offsetSec) / e.hopSec;
  if (!(x > 0)) return g[0];
  const i = Math.floor(x);
  if (i >= g.length - 1) return g[g.length - 1];
  return g[i] + (g[i + 1] - g[i]) * (x - i);
}
