// Built by scripts/audio/build-worklet.mjs from src/audio/dsp/. Do not edit: edit the source and rebuild.
"use strict";
// ── src/audio/dsp/biquad.ts ──
const m_biquad = (() => {
/**
 * Second-order IIR sections: design (RBJ Audio EQ Cookbook, and the BS.1770
 * K-weighting pair) and processing. Pure, no Web Audio: the same code runs in
 * the AudioWorklet, in Node for the offline renders, and in the tests.
 *
 * Coefficients are normalised (a0 = 1). Processing is transposed direct form
 * II, in double precision, which stays quiet for the low corner frequencies
 * here (a 38 Hz high-pass at 48 kHz) where direct form I in float32 would not.
 */

function norm(b0        , b1        , b2        , a0        , a1        , a2        )              {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function highPass(fs        , f0        , q        )              {
  const w = (2 * Math.PI * f0) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return norm((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}

function lowPass(fs        , f0        , q        )              {
  const w = (2 * Math.PI * f0) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return norm((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}

/** A notch: unity everywhere but a null at f0, `q` = f0 / bandwidth. */
function notch(fs        , f0        , q        )              {
  const w = (2 * Math.PI * f0) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return norm(1, -2 * c, 1, 1 + alpha, -2 * c, 1 - alpha);
}

/** Peaking EQ: `gainDb` at f0 (negative cuts), unity far from it. */
function peaking(fs        , f0        , gainDb        , q        )              {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f0) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return norm(1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A);
}

/**
 * The two K-weighting stages of ITU-R BS.1770, derived for any sample rate
 * the way libebur128 does it (its constants reproduce the standard's 48 kHz
 * table exactly). The browser runs at 44.1 or 48 kHz, so the table alone is
 * not enough.
 */
function kWeighting(fs        )                             {
  // Stage 1: the head's high-frequency shelf, about +4 dB above 2 kHz.
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf              = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // Stage 2: the RLB high-pass, about 38 Hz.
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / fs);
  const d = 1 + K1 / Q1 + K1 * K1;
  const hp              = { b0: 1, b1: -2, b2: 1, a1: (2 * (K1 * K1 - 1)) / d, a2: (1 - K1 / Q1 + K1 * K1) / d };
  return [shelf, hp];
}

/** One section's memory. */
class Biquad {
  c             ;
  z1 = 0;
  z2 = 0;
  constructor(c             ) {
    this.c = c;
  }
  reset()       {
    this.z1 = 0;
    this.z2 = 0;
  }
  /** One sample. */
  tick(x        )         {
    const c = this.c;
    const y = c.b0 * x + this.z1;
    this.z1 = c.b1 * x - c.a1 * y + this.z2;
    this.z2 = c.b2 * x - c.a2 * y;
    return y;
  }
  /** A block, in place, from `from` to `to`. */
  run(buf                             , from = 0, to = buf.length)       {
    const { b0, b1, b2, a1, a2 } = this.c;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = from; i < to; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    // Denormals: a filter ringing down to nothing must not cost a fortune.
    this.z1 = Math.abs(z1) < 1e-25 ? 0 : z1;
    this.z2 = Math.abs(z2) < 1e-25 ? 0 : z2;
  }
}

/** |H(e^jw)| in dB at frequency f, for checking a design. */
function magnitudeDb(c             , fs        , f        )         {
  const w = (2 * Math.PI * f) / fs;
  const cr = (k        ) => Math.cos(k * w);
  const ci = (k        ) => -Math.sin(k * w);
  const nr = c.b0 + c.b1 * cr(1) + c.b2 * cr(2);
  const ni = c.b1 * ci(1) + c.b2 * ci(2);
  const dr = 1 + c.a1 * cr(1) + c.a2 * cr(2);
  const di = c.a1 * ci(1) + c.a2 * ci(2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}
return { highPass, lowPass, notch, peaking, kWeighting, Biquad, magnitudeDb };
})();

// ── src/audio/dsp/fft.ts ──
const m_fft = (() => {
/**
 * An in-place radix-2 complex FFT with cached tables, and a real-input power
 * spectrum on top. Small and dependency-free so it runs inside an
 * AudioWorklet as well as in Node.
 */

const cache = new Map                ();

function tables(n        )         {
  let t = cache.get(n);
  if (t) return t;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  cache.set(n, t);
  return t;
}

/** Forward FFT of (re, im), in place. */
function fft(re              , im              )       {
  const n = re.length;
  const { cos, sin, rev } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Inverse FFT, in place, scaled by 1/n. */
function ifft(re              , im              )       {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

const windows = new Map                      ();

/** A periodic Hann window of length n (cached). */
function hann(n        )               {
  let w = windows.get(n);
  if (w) return w;
  w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  windows.set(n, w);
  return w;
}

/**
 * Hann-windowed power spectrum of x[from .. from+n), bins 0..n/2, added into
 * `acc` (so several frames can be averaged). Scaled so a full-scale sine reads
 * about 0 dB at its bin (window coherent gain removed).
 */
function addPowerSpectrum(x                   , from        , n        , acc              , re = new Float64Array(n), im = new Float64Array(n))       {
  const w = hann(n);
  for (let i = 0; i < n; i++) {
    re[i] = (x[from + i] ?? 0) * w[i];
    im[i] = 0;
  }
  fft(re, im);
  const scale = 4 / (n * n); // (2/(n*0.5))^2 for a Hann window
  for (let k = 0; k <= n / 2; k++) acc[k] += (re[k] * re[k] + im[k] * im[k]) * scale;
}
return { fft, ifft, hann, addPowerSpectrum };
})();

// ── src/audio/dsp/denoise.ts ──
const m_denoise = (() => {
/**
 * The hiss reducer: a short-time spectral gate (STFT, 1024 points, hop 256,
 * sqrt-Hann in and out, so overlap-add reconstructs exactly).
 *
 * Per bin, per frame:
 *   - Noise is *learned from quiet passages*: frames well under the running
 *     talking level update it quickly. It is held between 0.5x and 2x of a
 *     minimum-statistics estimate (the smallest smoothed power in the last
 *     ~1.5 s, bias-corrected), so a misjudged "quiet" frame can never teach
 *     it speech, and a show with no pauses still has an estimate.
 *   - Gain is Wiener, from the decision-directed a-priori SNR (Ephraim and
 *     Malah). Its heavy smoothing is what keeps the residual hiss steady
 *     instead of warbling ("musical noise", the underwater sound).
 *   - The gain is smoothed across neighbouring bins and never goes below a
 *     floor: some hiss is left, deliberately, rather than artifacts.
 *     Under 250 Hz the floor is shallower (voices live there, hiss does not).
 *
 * It also computes the speech/music features (music.ts) from the spectra it
 * already has, so the music detector costs almost nothing.
 *
 * Stereo is one gate, linked: both channels go through one complex FFT (left
 * in the real part, right in the imaginary), the gain is decided on their
 * average power, and the same gain is applied to both. A real gain keeps the
 * packing intact, so one inverse FFT gives both channels back. Half the work
 * of two gates, and the stereo image cannot wander as the gain moves. Mono
 * (most of the archive, or two identical channels) uses the real part only.
 *
 * Latency is exactly N samples, whatever the block size.
 */
const { fft, hann } = m_fft;
const N = 1024;
const HOP = 256;

const DEFAULT_DENOISE                          = { floorDb: -12, lowFloorDb: -5 };

/** Per-frame numbers a caller (the music detector, the tests) may read. */

const BINS = N / 2 + 1;
const SUB_V = 24; // frames per minimum subwindow
const SUB_U = 12; // subwindows: ~1.5 s at 48 kHz
const MS_BIAS = 1.9;
/** ~160 ms of frames at 48 kHz (30 x 5.33 ms). */
const PERSIST_FRAMES = 30;

class Denoiser {
           latency = N;
          fs        ;
          win              ;
          inBuf              ;
          inBufR              ;
          outBuf              ;
          outBufR              ;
          outQ              ;
          outQR              ;
  /** Two channels, linked. Set once, when the channels first differ. */
          stereo = false;
  /** This frame's power per bin (average over the channels). */
          pw = new Float64Array(BINS);
          cnt = 0;
          re = new Float64Array(N);
          im = new Float64Array(N);
          P = new Float64Array(BINS);
          noise = new Float64Array(BINS);
          quietNoise = new Float64Array(BINS);
          quietAge = 1e9;
          curMin = new Float64Array(BINS).fill(Infinity);
          subMins                 = Array.from({ length: SUB_U }, () => new Float64Array(BINS).fill(Infinity));
  /** The minimum over every finished subwindow, kept as they rotate (not searched per frame). */
          subMinAll = new Float64Array(BINS).fill(Infinity);
          subPos = 0;
          subCount = 0;
          prevClean = new Float64Array(BINS);
          gain = new Float64Array(BINS).fill(1);
          floor              ;
          frames = 0;
          talk = 0;
          peakRing               = Array.from({ length: PERSIST_FRAMES }, () => new Uint8Array(BINS));
          peakPos = 0;
          p0        ;
          p1        ;
          lo        ;
          hi        ;
          v0        ;
          v1        ;
  info            = { power: 0, cleanPower: 0, persistence: -1, voiceGain: 1 };
  /** Called once per frame (every HOP samples) with this frame's info. */
  onFrame                                  = null;

  constructor(o             ) {
    this.fs = o.fs;
    const h = hann(N);
    this.win = h.map((v) => Math.sqrt(v));
    this.inBuf = new Float64Array(N);
    this.inBufR = new Float64Array(N);
    this.outBuf = new Float64Array(N);
    this.outBufR = new Float64Array(N);
    this.outQ = new Float64Array(HOP);
    this.outQR = new Float64Array(HOP);
    this.floor = new Float64Array(BINS);
    const binHz = o.fs / N;
    for (let k = 0; k < BINS; k++) {
      const f = k * binHz;
      const t = Math.min(1, Math.max(0, (f - 250) / 50));
      this.floor[k] = Math.pow(10, (o.lowFloorDb + t * (o.floorDb - o.lowFloorDb)) / 20);
    }
    this.lo = Math.max(1, Math.round(100 / binHz));
    this.hi = Math.min(BINS - 1, Math.round(8000 / binHz));
    this.v0 = Math.round(300 / binHz);
    this.v1 = Math.min(BINS - 1, Math.round(4000 / binHz));
    this.p0 = Math.round(500 / binHz);
    this.p1 = Math.min(BINS - 2, Math.round(4000 / binHz));
  }

  reset()       {
    this.inBuf.fill(0);
    this.inBufR.fill(0);
    this.outBuf.fill(0);
    this.outBufR.fill(0);
    this.outQ.fill(0);
    this.outQR.fill(0);
    this.cnt = 0;
    this.gain.fill(1);
    this.prevClean.fill(0);
    // The noise estimate is kept: hiss belongs to the show, and a seek
    // within it should not have to learn it again.
  }

  /** Forget the noise too (a different show). */
  resetNoise()       {
    this.reset();
    this.P.fill(0);
    this.noise.fill(0);
    this.quietNoise.fill(0);
    this.quietAge = 1e9;
    this.curMin.fill(Infinity);
    for (const s of this.subMins) s.fill(Infinity);
    this.subMinAll.fill(Infinity);
    this.subCount = 0;
    this.stereo = false;
    this.frames = 0;
    this.talk = 0;
  }

  /**
   * From now on, two channels. Until now they were identical, so the right
   * channel's buffers start as copies of the left's: no seam.
   */
  goStereo()       {
    if (this.stereo) return;
    this.stereo = true;
    this.inBufR.set(this.inBuf);
    this.outBufR.set(this.outBuf);
    this.outQR.set(this.outQ);
  }

  /** Process in place: `l` alone (mono), or `l` and `r` once goStereo() was called. */
  process(l              , len        , r               )       {
    const st = this.stereo && r !== undefined;
    for (let i = 0; i < len; i++) {
      const at = N - HOP + this.cnt;
      this.inBuf[at] = l[i];
      l[i] = this.outQ[this.cnt];
      if (st) {
        this.inBufR[at] = r [i];
        r [i] = this.outQR[this.cnt];
      }
      if (++this.cnt === HOP) {
        this.cnt = 0;
        this.frame(st);
      }
    }
  }

          frame(st         )       {
    const { re, im, win, P, pw } = this;
    if (st) {
      for (let i = 0; i < N; i++) {
        re[i] = this.inBuf[i] * win[i];
        im[i] = this.inBufR[i] * win[i];
      }
    } else {
      for (let i = 0; i < N; i++) {
        re[i] = this.inBuf[i] * win[i];
        im[i] = 0;
      }
    }
    fft(re, im);
    this.frames++;

    // Power per bin. Packed stereo: |L|^2 + |R|^2 = (|Z_k|^2 + |Z_N-k|^2) / 2,
    // and the channel average is half that (equal to |L|^2 when L = R).
    if (st) {
      pw[0] = (re[0] * re[0] + im[0] * im[0]) / 2;
      for (let k = 1; k < BINS; k++) {
        const j = N - k;
        pw[k] = (re[k] * re[k] + im[k] * im[k] + re[j] * re[j] + im[j] * im[j]) / 4;
      }
      pw[N / 2] = (re[N / 2] * re[N / 2] + im[N / 2] * im[N / 2]) / 2;
    } else {
      for (let k = 0; k < BINS; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
    }

    // Smoothed periodogram, minimum statistics, frame power.
    let power = 0;
    for (let k = 0; k < BINS; k++) {
      const p = pw[k];
      P[k] = this.frames === 1 ? p : 0.8 * P[k] + 0.2 * p;
      if (P[k] < this.curMin[k]) this.curMin[k] = P[k];
      if (k >= this.lo && k <= this.hi) power += p;
    }
    if (++this.subCount === SUB_V) {
      this.subCount = 0;
      this.subMins[this.subPos].set(this.curMin);
      this.subPos = (this.subPos + 1) % SUB_U;
      this.curMin.fill(Infinity);
      const all = this.subMinAll;
      all.set(this.subMins[0]);
      for (let u = 1; u < SUB_U; u++) {
        const sm = this.subMins[u];
        for (let k = 0; k < BINS; k++) if (sm[k] < all[k]) all[k] = sm[k];
      }
    }

    // The talking level: follows loud frames quickly, sinks slowly.
    const pdb = 10 * Math.log10(power + 1e-20);
    this.talk = pdb > this.talk ? this.talk + 0.2 * (pdb - this.talk) : this.talk - 0.02;
    const quiet = pdb < this.talk - 15;
    this.quietAge = quiet ? 0 : this.quietAge + 1;

    for (let k = 0; k < BINS; k++) {
      const m = this.curMin[k] < this.subMinAll[k] ? this.curMin[k] : this.subMinAll[k];
      const ms = Number.isFinite(m) ? m * MS_BIAS : P[k];
      if (quiet) this.quietNoise[k] = this.quietNoise[k] > 0 ? 0.9 * this.quietNoise[k] + 0.1 * P[k] : P[k];
      // Quiet passages are the better teacher while they are recent (5 s).
      let n = this.quietAge < 940 && this.quietNoise[k] > 0 ? this.quietNoise[k] : ms;
      n = Math.min(Math.max(n, 0.5 * ms), 2 * ms);
      this.noise[k] = n;
    }

    // Decision-directed Wiener gain.
    const g = this.gain;
    for (let k = 0; k < BINS; k++) {
      const p = pw[k];
      const n = this.noise[k] + 1e-20;
      const post = p / n;
      let xi = 0.98 * (this.prevClean[k] / n) + 0.02 * Math.max(post - 1, 0);
      if (xi < 0.003) xi = 0.003;
      g[k] = xi / (1 + xi);
    }
    // Across frequency: a 1-2-1 smoothing, then the floor.
    let prev = g[0];
    for (let k = 1; k < BINS - 1; k++) {
      const cur = g[k];
      g[k] = 0.25 * prev + 0.5 * cur + 0.25 * g[k + 1];
      prev = cur;
    }
    let vg = 0;
    let clean = 0;
    for (let k = 0; k < BINS; k++) {
      if (g[k] < this.floor[k]) g[k] = this.floor[k];
      this.prevClean[k] = g[k] * g[k] * pw[k];
      if (k >= this.v0 && k <= this.v1) vg += g[k];
      if (k >= this.lo && k <= this.hi) clean += this.prevClean[k];
    }

    // Partial persistence (see FrameInfo).
    const ring = this.peakRing[this.peakPos];
    const old = this.peakRing[(this.peakPos + 1) % PERSIST_FRAMES];
    ring.fill(0);
    let peaks = 0;
    let kept = 0;
    for (let k = this.p0; k <= this.p1; k++) {
      const pk = pw[k];
      if (pk > pw[k - 1] && pk > pw[k + 1] && pk > 4 * this.noise[k]) {
        ring[k] = 1;
        peaks++;
        if (old[k - 1] || old[k] || old[k + 1]) kept++;
      }
    }
    this.peakPos = (this.peakPos + 1) % PERSIST_FRAMES;
    const info = this.info;
    info.power = power;
    info.cleanPower = clean;
    info.persistence = peaks >= 4 ? kept / peaks : -1;
    info.voiceGain = vg / (this.v1 - this.v0 + 1);
    this.onFrame?.(this.info);

    // Apply (Hermitian: mirror the gain), invert, window, overlap-add.
    for (let k = 0; k < BINS; k++) {
      re[k] *= g[k];
      im[k] *= g[k];
      if (k > 0 && k < N / 2) {
        re[N - k] *= g[k];
        im[N - k] *= g[k];
      }
    }
    for (let i = 0; i < N; i++) im[i] = -im[i];
    fft(re, im);
    // ifft = conj(fft(conj)) / N: the real part is the left (or only)
    // channel, the imaginary part, negated, the right.
    const scale = 1 / N / 2; // and 1/2: sqrt-Hann squared overlaps to 2 at hop N/4
    for (let i = 0; i < N; i++) this.outBuf[i] += re[i] * scale * win[i];
    this.outQ.set(this.outBuf.subarray(0, HOP));
    this.outBuf.copyWithin(0, HOP);
    this.outBuf.fill(0, N - HOP);
    if (st) {
      for (let i = 0; i < N; i++) this.outBufR[i] -= im[i] * scale * win[i];
      this.outQR.set(this.outBufR.subarray(0, HOP));
      this.outBufR.copyWithin(0, HOP);
      this.outBufR.fill(0, N - HOP);
      this.inBufR.copyWithin(0, HOP);
    }
    this.inBuf.copyWithin(0, HOP);
  }
}
return { N, HOP, DEFAULT_DENOISE, PERSIST_FRAMES, Denoiser };
})();

// ── src/audio/dsp/hum.ts ──
const m_hum = (() => {
/**
 * Mains hum: found, then notched, only where it is actually there.
 *
 * Detection runs on a copy decimated to about 2 kHz, low-passed at 600 Hz
 * first (the 8th harmonic of 60 Hz is 480 Hz: a 440 Hz filter on a 1 kHz
 * copy hid it, measured on 1996-05-10). Every half second a 1 s Hann frame
 * (2,048 points, ~1 Hz bins) is taken; only frames quieter than the running median are
 * averaged, because hum is plainest in the pauses and speech or music
 * harmonics wander while a mains line does not. A line is a harmonic of 50
 * or 60 Hz whose averaged power stands DETECT_DB over the median of the bins
 * 4..15 Hz either side; its exact frequency comes from a parabola through
 * the peak bin and its neighbours (tape speed moves hum off 60.00 Hz).
 *
 * Each detected line gets two identical notches in series, so the cut stays
 * over 20 dB within a few tenths of a hertz of the estimate. A notch is
 * written y = x - d * bandpass(x): with depth d = 1 it is exactly a notch,
 * and d ramps over ~0.3 s, so a line engaging or letting go never clicks.
 * Lines engage at DETECT_DB and release only after RELEASE_EVALS evaluations
 * under RELEASE_DB (hysteresis), and new lines are not engaged while the
 * music detector says music (a held bass note at 120 Hz is not hum).
 */
const { Biquad, lowPass } = m_biquad;
const { addPowerSpectrum } = m_fft;
const DETECT_DB = 10;
/**
 * Once a family is established (a line at DETECT_DB), its other harmonics
 * engage at this, if they sit within FAMILY_TOL_HZ of k times the fundamental
 * the strong lines agree on. A weak harmonic exactly where the mains puts it
 * is the mains (1996-05-10: the 8th sat at 9-12 dB for a minute).
 */
const FAMILY_DB = 6;
const FAMILY_TOL_HZ = 1;
const RELEASE_DB = 5;
const RELEASE_EVALS = 20; // 10 s
const HARMONICS = 8;
const FFT = 2048;
const EVAL_EVERY = 0.5; // s

/** A unity-peak bandpass (RBJ constant 0 dB peak): 1 - this is the notch. */
function bandpass(fs        , f0        , bwHz        )              {
  const q = f0 / bwHz;
  const w = (2 * Math.PI * f0) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

class HumRemover {
          fs        ;
          channels        ;
          D        ;
          decFs        ;
          aa          ;
          phase = 0;
          ring = new Float64Array(FFT);
  /** Evaluation scratch, kept (no allocation on the audio thread). */
          frame = new Float64Array(FFT);
          spec = new Float64Array(FFT / 2 + 1);
          fre = new Float64Array(FFT);
          fim = new Float64Array(FFT);
          rpos = 0;
          sinceEval = 0;
          evalLen        ;
          avg = new Float64Array(FFT / 2 + 1);
          avgN = 0;
          energies           = [];
          lines = new Map              ();
          family                 = null;
          lastProm = new Map                ();
          depthStep        ;
  /** Set by the caller from the music detector: no new lines while true. */
  musicNow = false;

  constructor(fs        , channels = 2) {
    this.fs = fs;
    this.channels = channels;
    this.D = Math.max(1, Math.round(fs / 2000));
    this.decFs = fs / this.D;
    this.aa = [0, 1, 2].map(() => new Biquad(lowPass(fs, 600, 0.7071)));
    this.evalLen = Math.round(EVAL_EVERY * this.decFs);
    this.depthStep = 1 / (0.3 * fs);
  }

  reset()       {
    this.avg.fill(0);
    this.avgN = 0;
    this.energies = [];
    this.lines.clear();
    this.family = null;
    this.ring.fill(0);
    for (const b of this.aa) b.reset();
  }

  status()            {
    return {
      family: this.family,
      lines: [...this.lines.values()].map((l) => ({ k: l.k, freq: l.freq, prominence: this.lastProm.get(l.k) ?? 0, depth: l.depth })),
    };
  }

  /** Feed the detector with the mono mix (one call per block). */
  analyse(mono              , len        )       {
    for (let i = 0; i < len; i++) {
      const y = this.aa[2].tick(this.aa[1].tick(this.aa[0].tick(mono[i])));
      if (++this.phase < this.D) continue;
      this.phase = 0;
      this.ring[this.rpos] = y;
      this.rpos = (this.rpos + 1) % FFT;
      if (++this.sinceEval >= this.evalLen) {
        this.sinceEval = 0;
        this.evaluate();
      }
    }
  }

          evaluate()       {
    // The last FFT decimated samples, in order.
    const frame = this.frame;
    let e = 0;
    for (let i = 0; i < FFT; i++) {
      const v = this.ring[(this.rpos + i) % FFT];
      frame[i] = v;
      e += v * v;
    }
    if (e <= 0) return;
    this.energies.push(e);
    if (this.energies.length > 40) this.energies.shift();
    const sorted = [...this.energies].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    if (this.energies.length >= 4 && e > median) return; // only the quiet half teaches
    const spec = this.spec;
    spec.fill(0);
    addPowerSpectrum(frame, 0, FFT, spec, this.fre, this.fim);
    // A running average with a memory of about 12 quiet frames.
    const a = this.avgN < 12 ? 1 / ++this.avgN : 1 / 12;
    for (let k = 0; k < spec.length; k++) this.avg[k] += (spec[k] - this.avg[k]) * a;
    if (this.avgN < 4) return;

    const binHz = this.decFs / FFT;
    const lineAt = (f        ) => {
      const c = Math.round(f / binHz);
      let best = c;
      for (let k = c - 2; k <= c + 2; k++) if ((this.avg[k] ?? 0) > (this.avg[best] ?? 0)) best = k;
      const around           = [];
      for (let k = Math.round((f - 15) / binHz); k <= Math.round((f - 4) / binHz); k++) around.push(this.avg[k] ?? 0);
      for (let k = Math.round((f + 4) / binHz); k <= Math.round((f + 15) / binHz); k++) around.push(this.avg[k] ?? 0);
      around.sort((x, y) => x - y);
      const med = around[around.length >> 1] || 1e-30;
      const p = this.avg[best] ?? 0;
      // Parabolic interpolation on log power for the true frequency.
      const l = Math.log((this.avg[best - 1] ?? 0) + 1e-30);
      const m = Math.log(p + 1e-30);
      const r = Math.log((this.avg[best + 1] ?? 0) + 1e-30);
      const den = l - 2 * m + r;
      const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0;
      return { prom: 10 * Math.log10(p / med + 1e-30), freq: (best + off) * binHz };
    };
    // The fundamental the engaged lines agree on (their frequency over k,
    // weighted by prominence): the established family's harmonics are looked
    // for at k times it, not at k times 50 or 60 (59.7 Hz puts the 8th at
    // 477.6, outside a search around 480), and weaker ones judged by it.
    let f0 = 0;
    let w = 0;
    for (const l of this.lines.values()) {
      const p = Math.max(0, this.lastProm.get(l.k) ?? 0);
      if (l.want > 0 && p >= DETECT_DB) {
        f0 += (l.freq / l.k) * p;
        w += p;
      }
    }
    f0 = w > 0 ? f0 / w : 0;

    const scan = (base         ) => {
      const fund = this.family === base && f0 > 0 ? f0 : base;
      return Array.from({ length: HARMONICS }, (_, i) => lineAt(fund * (i + 1))).filter((x) => x.freq < this.decFs / 2 - 20);
    };
    const s50 = scan(50);
    const s60 = scan(60);
    const best = (s                    ) => Math.max(...s.map((x) => x.prom));
    const fam          = best(s60) >= best(s50) ? 60 : 50;
    const s = fam === 60 ? s60 : s50;
    if (this.family !== fam && this.lines.size) {
      // The other family won: let the current lines go.
      for (const l of this.lines.values()) l.want = 0;
    }
    this.family = best(s) >= DETECT_DB ? fam : this.family;

    s.forEach((h, i) => {
      const k = i + 1;
      const inFamily = f0 > 0 && Math.abs(h.freq - k * f0) <= FAMILY_TOL_HZ;
      const engageAt = inFamily ? FAMILY_DB : DETECT_DB;
      this.lastProm.set(k, h.prom);
      const line = this.lines.get(k);
      if (line && this.family === fam) {
        if (h.prom >= RELEASE_DB) {
          line.quietEvals = 0;
          line.want = 1;
          // Follow a drifting line (only while it is plainly there).
          if (h.prom >= DETECT_DB && Math.abs(h.freq - line.freq) < 1.5) this.retune(line, 0.7 * line.freq + 0.3 * h.freq);
        } else if (++line.quietEvals >= RELEASE_EVALS) line.want = 0;
      } else if (!line && h.prom >= engageAt && !this.musicNow && this.family === fam) {
        this.lines.set(k, this.makeLine(k, inFamily ? 0.5 * (h.freq + k * f0) : h.freq));
      }
    });
  }

          bw(k        )         {
    return 2.5 + 0.4 * (k - 1);
  }

          makeLine(k        , freq        )       {
    const c = bandpass(this.fs, freq, this.bw(k));
    return { k, freq, depth: 0, want: 1, quietEvals: 0, bp: Array.from({ length: this.channels }, () => [new Biquad(c), new Biquad(c)]) };
  }

          retune(l      , freq        )       {
    if (Math.abs(freq - l.freq) < 0.02) return;
    l.freq = freq;
    const c = bandpass(this.fs, freq, this.bw(l.k));
    for (const ch of l.bp) for (const b of ch) b.c = c;
  }

  /** Notch every engaged line, channel by channel, in place. */
  process(ch                , len        )       {
    for (const l of this.lines.values()) {
      for (let c = 0; c < ch.length && c < l.bp.length; c++) {
        const x = ch[c];
        const [b1, b2] = l.bp[c];
        let d = l.depth;
        for (let i = 0; i < len; i++) {
          d += d < l.want ? this.depthStep : d > l.want ? -this.depthStep : 0;
          if (d < 0) d = 0;
          else if (d > 1) d = 1;
          const y1 = x[i] - d * b1.tick(x[i]);
          x[i] = y1 - d * b2.tick(y1);
        }
        if (c === ch.length - 1 || c === l.bp.length - 1) l.depth = d;
      }
      if (l.want === 0 && l.depth === 0) this.lines.delete(l.k);
    }
  }
}
return { DETECT_DB, FAMILY_DB, RELEASE_DB, HumRemover };
})();

// ── src/audio/dsp/music.ts ──
const m_music = (() => {
/**
 * Is this music? The bumpers (the songs in and out of every hour) are loved,
 * and a voice-tuned denoiser smears them, so Clean up eases off while this
 * says music.
 *
 * The feature is the spread of the signal's loudness over the last WINDOW_S:
 * the standard deviation of log energy in ~21 ms steps. Talk radio stops
 * between words and phrases, so its log energy swings widely; a song's
 * envelope barely moves. Calibrated on hand-labelled openings from four
 * decades of the archive (docs/audio-processing/README.md, "Music"):
 *
 *                      p10    p50    p90     (decades, 3 s windows)
 *   music              0.19   0.34   0.46
 *   speech             0.44   1.35   2.57
 *
 * A 3 s window caught 90 % of music windows and flagged 13 % of speech
 * windows. Two other features were tried and dropped: spectral
 * stationarity (0.99 for everything) and partial persistence at 47 Hz bins
 * (no separation; at 12 Hz bins it added 7 points of music detection for a
 * second large FFT per hop, too dear on an old phone).
 *
 * The score moves smoothly (attack ~0.7 s, release ~2 s). The caller squares
 * it before easing anything, so an unsure "maybe" barely changes the gate.
 */

const WINDOW_S = 3;
/** One analysis step, about 21 ms of the caller's frames. */
const STEP_S = 0.021;
/** logsd at or under which a window is music; at or over SPEECH_SD, speech. */
const MUSIC_SD = 0.35;
const SPEECH_SD = 0.65;

class MusicDetector {
          framesPerStep        ;
          acc = 0;
          accN = 0;
          log              ;
          pos = 0;
          n = 0;
          up        ;
          down        ;
  /** 0 (speech) .. 1 (music), smoothed. */
  score = 0;
  /** The last window's spread of log energy, for calibration. */
  sd = 0;

  constructor(frameRate        ) {
    this.framesPerStep = Math.max(1, Math.round(STEP_S * frameRate));
    const steps = Math.round(WINDOW_S / STEP_S);
    this.log = new Float64Array(steps);
    const stepRate = frameRate / this.framesPerStep;
    this.up = 1 - Math.exp(-1 / (0.7 * stepRate));
    this.down = 1 - Math.exp(-1 / (2 * stepRate));
  }

  reset()       {
    this.acc = this.accN = 0;
    this.log.fill(0);
    this.pos = this.n = 0;
    this.score = 0;
  }

  /** One frame's power. */
  push(power        )       {
    this.acc += power;
    if (++this.accN < this.framesPerStep) return;
    const e = this.acc;
    this.acc = this.accN = 0;
    const len = this.log.length;
    this.log[this.pos] = Math.log10(e + 1e-12);
    this.pos = (this.pos + 1) % len;
    if (this.n < len) {
      this.n++;
      return;
    }
    let m = 0;
    for (let i = 0; i < len; i++) m += this.log[i];
    m /= len;
    // A silent window (dead air) is neither: leave the score where it is.
    if (m < -9) return;
    let v = 0;
    for (let i = 0; i < len; i++) v += (this.log[i] - m) ** 2;
    this.sd = Math.sqrt(v / len);
    const want = Math.max(0, Math.min(1, (SPEECH_SD - this.sd) / (SPEECH_SD - MUSIC_SD)));
    this.score += (want - this.score) * (want > this.score ? this.up : this.down);
  }
}
return { WINDOW_S, MUSIC_SD, SPEECH_SD, MusicDetector };
})();

// ── src/audio/dsp/cleanup.ts ──
const m_cleanup = (() => {
/**
 * Clean up: rumble, hum and hiss, in that order.
 *
 *   high-pass   4th-order Butterworth at HPF_HZ: rumble, handling noise,
 *               the turntable and the tape transport. Voices start above it.
 *   hum         notches only when hum.ts finds mains hum (50 or 60 Hz and
 *               harmonics); otherwise nothing at all.
 *   hiss        the spectral gate (denoise.ts), eased off while music.ts
 *               hears music: a bumper keeps its cymbals.
 *
 * The output here is the *wet* signal, delayed by exactly `latency` samples.
 * The chain mixes it with the dry signal it delays by the same amount.
 *
 * Mono (or two identical channels) runs the gate, the costly part, on one
 * channel and copies it. When the channels first differ the gate goes linked
 * stereo (denoise.ts: one FFT for both, one gain for both), carrying on from
 * where it was: they were identical until then.
 */
const { Biquad, highPass } = m_biquad;
const { DEFAULT_DENOISE, Denoiser, HOP, N } = m_denoise;
const { HumRemover } = m_hum;
const { MusicDetector } = m_music;
const HPF_HZ = 70;
/** How far the gate backs off at full music score (1 = all the way to dry). Applied to the score squared. */
const MUSIC_EASE = 0.85;

class Cleanup {
           latency = N;
           fs        ;
          hpf            ;
           hum            ;
          dn          ;
           music               ;
          stereo = false;
  /** HPF+hum signal, delayed N, per channel: the gate's dry. */
          aDelay                ;
          apos = 0;
          gateMix = 1;
          mono              ;
          dryL = new Float32Array(128);
          dryR = new Float32Array(128);

  constructor(fs        ) {
    this.fs = fs;
    // Butterworth 4th order = two sections, Q 0.5412 and 1.3066.
    this.hpf = [0, 1].map(() => [new Biquad(highPass(fs, HPF_HZ, 0.5412)), new Biquad(highPass(fs, HPF_HZ, 1.3066))]);
    this.hum = new HumRemover(fs, 2);
    this.dn = new Denoiser({ fs, ...DEFAULT_DENOISE });
    this.music = new MusicDetector(fs / HOP);
    this.dn.onFrame = (f) => this.music.push(f.power);
    this.aDelay = [new Float32Array(N), new Float32Array(N)];
    this.mono = new Float32Array(128);
  }

  /** A new show: forget everything learned. */
  resetAll()       {
    for (const s of this.hpf) for (const b of s) b.reset();
    this.hum.reset();
    this.dn.resetNoise();
    this.music.reset();
    this.stereo = false;
    for (const a of this.aDelay) a.fill(0);
    this.gateMix = 1;
  }

  /** A seek: the signal jumps, but the show's hiss and hum are the same. */
  resetPosition()       {
    for (const s of this.hpf) for (const b of s) b.reset();
    this.dn.reset();
    for (const a of this.aDelay) a.fill(0);
  }

  /** In place: two channels in, the wet signal (N samples later) out. */
  process(ch                , len        )       {
    const [l, r] = ch;
    if (!this.stereo) {
      for (let i = 0; i < len; i++) {
        if (l[i] !== r[i]) {
          this.stereo = true;
          this.dn.goStereo();
          break;
        }
      }
    }
    for (let c = 0; c < 2; c++) {
      this.hpf[c][0].run(ch[c], 0, len);
      this.hpf[c][1].run(ch[c], 0, len);
    }
    if (this.mono.length < len) {
      this.mono = new Float32Array(len);
      this.dryL = new Float32Array(len);
      this.dryR = new Float32Array(len);
    }
    for (let i = 0; i < len; i++) this.mono[i] = 0.5 * (l[i] + r[i]);
    this.hum.musicNow = this.music.score > 0.5;
    this.hum.analyse(this.mono, len);
    this.hum.process(ch, len);

    // The gate's dry: the HPF+hum signal, delayed to line up with its output.
    const { dryL, dryR } = this;
    for (let i = 0; i < len; i++) {
      const p = this.apos;
      dryL[i] = this.aDelay[0][p];
      dryR[i] = this.aDelay[1][p];
      this.aDelay[0][p] = l[i];
      this.aDelay[1][p] = r[i];
      this.apos = (p + 1) % N;
    }
    if (this.stereo) this.dn.process(l, len, r);
    else {
      this.dn.process(l, len);
      r.set(l.subarray(0, len));
    }

    // Ease the gate off during music, smoothly across the block.
    const sc = this.music.score;
    const want = 1 - MUSIC_EASE * sc * sc;
    const m0 = this.gateMix;
    for (let i = 0; i < len; i++) {
      const m = m0 + ((want - m0) * (i + 1)) / len;
      l[i] = dryL[i] + m * (l[i] - dryL[i]);
      r[i] = dryR[i] + m * (r[i] - dryR[i]);
    }
    this.gateMix = want;
  }
}
return { HPF_HZ, MUSIC_EASE, Cleanup };
})();

// ── src/audio/dsp/compressor.ts ──
const m_compressor = (() => {
/**
 * The leveling compressor: the stage after the slow loudness AGC that evens
 * out phrase-to-phrase level, the way a broadcast "talk" processor does.
 * Soft knee, RMS detector (~50 ms, a phrase's level rather than a
 * syllable's), linked channels, slow release.
 *
 * Gated: when a fast detector falls well under the talking level (a pause
 * between phrases, dead air), the gain stops following the signal. An
 * ungated compressor recovers during every pause, lifting the hiss and room
 * under the talk: that rise and fall is "breathing", the sound of an app
 * filter. In the gate the gain may only come down, toward the phrase's
 * average reduction, never up: a plain hold keeps the gain of the last,
 * quietest syllable (1.2 to 2 dB above the phrase's on the archive
 * openings), and settling both ways lifted the floor after every loud last
 * word by as much.
 *
 * Not DynamicsCompressorNode: that differs between browsers (Chromium's has
 * a hidden makeup gain and a pre-delay), and this has to sound the same
 * everywhere and in the offline renders.
 *
 * The gain is computed once per SUB samples and interpolated, which keeps
 * the log/pow work off the per-sample path (an old phone's budget).
 */

const { Biquad, kWeighting } = m_biquad;

const SUB = 16;

class Compressor {
          o                ;
          att        ;
          rel        ;
          det        ;
          ms = 0;
          fastMs = 0;
          fastDet        ;
  /** The talking level the gate is relative to, dB: follows ungated speech slowly. */
          talkDb = -30;
          talkA        ;
  /** The phrase's average gain reduction: where the gate settles the gain. */
          avgGr = 0;
          avgA        ;
          gateA        ;
          grDb = 0;
          makeup        ;
          gNow        ;
          gStep = 0;
          sub = 0;
          kw                 ;
  /** Deepest gain reduction since last read, dB (positive). */
  maxGrDb = 0;
  /** True while the gate is holding. */
  gated = false;

  constructor(o                ) {
    this.o = o;
    const step = SUB / o.fs;
    this.att = 1 - Math.exp(-step / (o.attackMs / 1000));
    this.rel = 1 - Math.exp(-step / (o.releaseMs / 1000));
    this.det = 1 - Math.exp(-1 / ((o.rmsMs / 1000) * o.fs));
    this.fastDet = 1 - Math.exp(-1 / (0.01 * o.fs));
    this.talkA = 1 - Math.exp(-step / 2);
    this.avgA = 1 - Math.exp(-step / 1);
    this.gateA = 1 - Math.exp(-step / 0.15);
    this.makeup = Math.pow(10, o.makeupDb / 20);
    this.gNow = this.makeup;
    this.kw = o.kWeighted ? kWeighting(o.fs).map((c) => new Biquad(c)) : null;
  }

  reset()       {
    this.ms = 0;
    this.fastMs = 0;
    this.talkDb = -30;
    this.avgGr = 0;
    this.grDb = 0;
    this.gNow = this.makeup;
    this.gStep = 0;
    this.sub = 0;
    this.gated = false;
    if (this.kw) for (const b of this.kw) b.reset();
  }

  /** Current gain reduction, dB (positive). */
  get gainReductionDb()         {
    return this.grDb;
  }

  /** Static curve: gain reduction in dB (>= 0) for an input level in dB. */
  static curve(levelDb        , t        , ratio        , knee        )         {
    const over = levelDb - t;
    if (2 * over <= -knee) return 0;
    if (2 * over >= knee) return over - over / ratio;
    const x = over + knee / 2;
    return ((1 - 1 / ratio) * x * x) / (2 * knee);
  }

  process(ch                , len        )       {
    const { thresholdDb, ratio, kneeDb, gateBelowDb } = this.o;
    const L = ch[0];
    const R = ch.length > 1 ? ch[1] : ch[0];
    const det = this.det;
    for (let i = 0; i < len; i++) {
      const a = L[i];
      const b = R[i];
      let p        ;
      if (this.kw) {
        const k = this.kw[1].tick(this.kw[0].tick(0.5 * (a + b)));
        p = k * k;
      } else p = 0.5 * (a * a + b * b);
      this.ms += (p - this.ms) * det;
      this.fastMs += (p - this.fastMs) * this.fastDet;
      if (++this.sub === SUB) {
        this.sub = 0;
        const lvl = 10 * Math.log10(this.ms + 1e-12);
        const fast = 10 * Math.log10(this.fastMs + 1e-12);
        this.gated = fast < thresholdDb - gateBelowDb || fast < this.talkDb - gateBelowDb;
        if (!this.gated) {
          this.talkDb += (lvl - this.talkDb) * this.talkA;
          const want = Compressor.curve(lvl, thresholdDb, ratio, kneeDb);
          this.grDb += (want - this.grDb) * (want > this.grDb ? this.att : this.rel);
          if (this.grDb > this.maxGrDb) this.maxGrDb = this.grDb;
          this.avgGr += (this.grDb - this.avgGr) * this.avgA;
        } else if (this.avgGr > this.grDb) {
          // In a pause the gain may only come *down*, toward the phrase's
          // average reduction: after a soft last syllable it settles there
          // (the pause sits where the talk around it sits); after a loud
          // last word it holds. It never rises in a pause, which is what
          // breathing is.
          this.grDb += (this.avgGr - this.grDb) * this.gateA;
        }
        const gNext = Math.pow(10, -this.grDb / 20) * this.makeup;
        this.gStep = (gNext - this.gNow) / SUB;
      }
      this.gNow += this.gStep;
      L[i] = a * this.gNow;
      if (R !== L) R[i] = b * this.gNow;
    }
  }
}
return { Compressor };
})();

// ── src/audio/dsp/oversample.ts ──
const m_oversample = (() => {
/**
 * Inter-sample ("true") peaks, by 4x polyphase interpolation in the manner of
 * ITU-R BS.1770-4 Annex 2: 48 taps, 12 per phase. A sample peak can read
 * −1.5 dBFS while the reconstructed waveform crosses 0 dBFS; a limiter that
 * promises −1 dBTP has to look between the samples.
 */

const PHASES = 4;
const TAPS_PER_PHASE = 12;

function besselI0(x        )         {
  let s = 1;
  let t = 1;
  for (let k = 1; k < 30; k++) {
    t *= (x / (2 * k)) ** 2;
    s += t;
  }
  return s;
}

/** phase[p][k]: the k-th tap of phase p. Each phase sums to 1 (DC passes exactly). */
function design()                 {
  const M = PHASES * TAPS_PER_PHASE;
  const fc = 0.5 / PHASES * 0.94; // pass to ~94 % of the original Nyquist
  const beta = 7;
  const h = new Float64Array(M);
  for (let n = 0; n < M; n++) {
    const t = n - (M - 1) / 2;
    const sinc = t === 0 ? 1 : Math.sin(2 * Math.PI * fc * t) / (2 * Math.PI * fc * t);
    const r = (2 * n) / (M - 1) - 1;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
    h[n] = sinc * w;
  }
  const phases                 = [];
  for (let p = 0; p < PHASES; p++) {
    const ph = new Float64Array(TAPS_PER_PHASE);
    let s = 0;
    for (let k = 0; k < TAPS_PER_PHASE; k++) {
      ph[k] = h[k * PHASES + p];
      s += ph[k];
    }
    for (let k = 0; k < TAPS_PER_PHASE; k++) ph[k] /= s;
    phases.push(ph);
  }
  return phases;
}

const PH = design();
/** The largest sum of |taps| of any phase: |reconstruction| <= this x max|sample| in the window. */
const L1 = Math.max(...PH.map((ph) => ph.reduce((a, v) => a + Math.abs(v), 0)));

/**
 * Streaming detector: feed samples one at a time, get the largest absolute
 * value of the reconstructed waveform around each (the sample itself included).
 * Its delay is TAPS_PER_PHASE / 2 samples, which callers align for.
 */
class TruePeakDetector {
          hist = new Float64Array(TAPS_PER_PHASE);
          pos = 0;
  reset()       {
    this.hist.fill(0);
    this.pos = 0;
  }
  /**
   * `below`: a caller that only needs to know whether the peak reaches it
   * (the limiter, with its ceiling). When the window's largest sample times
   * L1 is under it, the reconstruction cannot reach it, and that bound is
   * returned instead of the exact peak (still >= the sample, still < below):
   * 12 comparisons instead of 48 multiplies, for nearly every sample.
   */
  tick(x        , below = Infinity)         {
    const h = this.hist;
    h[this.pos] = x;
    if (below !== Infinity) {
      let m = 0;
      for (let k = 0; k < TAPS_PER_PHASE; k++) {
        const a = h[k] < 0 ? -h[k] : h[k];
        if (a > m) m = a;
      }
      const bound = m * L1;
      if (bound < below) {
        this.pos = (this.pos + 1) % TAPS_PER_PHASE;
        return bound;
      }
    }
    let peak = 0;
    for (let p = 0; p < PHASES; p++) {
      const ph = PH[p];
      let y = 0;
      let j = this.pos;
      for (let k = 0; k < TAPS_PER_PHASE; k++) {
        y += ph[k] * h[j];
        j = j === 0 ? TAPS_PER_PHASE - 1 : j - 1;
      }
      const a = Math.abs(y);
      if (a > peak) peak = a;
    }
    this.pos = (this.pos + 1) % TAPS_PER_PHASE;
    return peak;
  }
}

/** The true peak of a whole channel, dBTP. */
function truePeakOf(x                             )         {
  const d = new TruePeakDetector();
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    const t = d.tick(x[i]);
    if (t > peak) peak = t;
  }
  for (let i = 0; i < TAPS_PER_PHASE; i++) {
    const t = d.tick(0);
    if (t > peak) peak = t;
  }
  return 20 * Math.log10(peak || 1e-12);
}
return { PHASES, TAPS_PER_PHASE, TruePeakDetector, truePeakOf };
})();

// ── src/audio/dsp/limiter.ts ──
const m_limiter = (() => {
/**
 * A lookahead peak limiter that holds the reconstructed waveform under a
 * ceiling (true peak, from the 4x detector in oversample.ts).
 *
 * The classic construction, which guarantees the ceiling:
 *   1. required gain r[n] = min(1, ceiling / truePeak(x[n]))
 *   2. m[n] = min of r over the last L samples (a monotonic deque, O(1))
 *   3. e[n] = min(m[n], the released previous value): release only, never attack
 *   4. s[n] = mean of e over the last L samples (a box filter: a smooth ramp)
 *   5. y[n] = x[n - (L - 1)] * s[n]
 * For a peak at p, e[p .. p+L-1] <= r[p], so their mean s[p+L-1] <= r[p], and
 * that is the gain x[p] leaves with. The ramp into a peak lasts L samples; no
 * gain change is ever a step.
 */
const { TAPS_PER_PHASE, TruePeakDetector } = m_oversample;

class Limiter {
           latency        ;
          L        ;
          ceiling        ;
          relCoef        ;
          det                    ;
  /** Delay lines for the audio, one per channel. */
          delay                ;
          dpos = 0;
          dlen        ;
  /** Monotonic deque of (index, value) for the sliding minimum. */
          dqIdx            ;
          dqVal              ;
          dqHead = 0;
          dqTail = 0;
          n = 0;
          env = 1;
          box              ;
          boxPos = 0;
          boxSum        ;
  /** The smallest gain applied since last read, for the meters and the tests. */
  minGain = 1;

  constructor(o             ) {
    this.L = Math.max(1, Math.round((o.lookaheadMs / 1000) * o.fs));
    this.ceiling = Math.pow(10, o.ceilingDb / 20);
    this.relCoef = 1 - Math.exp(-1 / ((o.releaseMs / 1000) * o.fs));
    this.det = Array.from({ length: o.channels }, () => new TruePeakDetector());
    // The detector's own delay is TAPS_PER_PHASE / 2: the audio waits for it too.
    const detDelay = TAPS_PER_PHASE / 2;
    this.dlen = this.L - 1 + detDelay + 1;
    this.latency = this.L - 1 + detDelay;
    this.delay = Array.from({ length: o.channels }, () => new Float64Array(this.dlen));
    this.dqIdx = new Int32Array(this.L + 2);
    this.dqVal = new Float64Array(this.L + 2);
    this.box = new Float64Array(this.L).fill(1);
    this.boxSum = this.L;
  }

  reset()       {
    for (const d of this.det) d.reset();
    for (const d of this.delay) d.fill(0);
    this.dqHead = this.dqTail = 0;
    this.env = 1;
    this.box.fill(1);
    this.boxSum = this.L;
  }

  /** Process `len` samples of each channel in place. */
  process(ch                , len        )       {
    const C = ch.length;
    const cap = this.L + 2;
    for (let i = 0; i < len; i++) {
      // Peak of the reconstruction around this sample, over all channels.
      let pk = 0;
      for (let c = 0; c < C; c++) {
        const x = ch[c][i];
        const a = this.det[c].tick(x, this.ceiling);
        if (a > pk) pk = a;
        this.delay[c][this.dpos] = x;
      }
      const r = pk > this.ceiling ? this.ceiling / pk : 1;
      // Sliding minimum over the last L samples.
      const n = this.n++;
      while (this.dqTail !== this.dqHead && this.dqVal[(this.dqTail - 1 + cap) % cap] >= r) this.dqTail = (this.dqTail - 1 + cap) % cap;
      this.dqIdx[this.dqTail] = n;
      this.dqVal[this.dqTail] = r;
      this.dqTail = (this.dqTail + 1) % cap;
      while (this.dqIdx[this.dqHead] <= n - this.L) this.dqHead = (this.dqHead + 1) % cap;
      const m = this.dqVal[this.dqHead];
      // Release toward 1, never attack (the box filter does that).
      this.env = Math.min(m, this.env + (1 - this.env) * this.relCoef);
      this.boxSum += this.env - this.box[this.boxPos];
      this.box[this.boxPos] = this.env;
      this.boxPos = (this.boxPos + 1) % this.L;
      const g = this.boxSum / this.L;
      if (g < this.minGain) this.minGain = g;
      const rd = (this.dpos - this.latency + this.dlen) % this.dlen;
      for (let c = 0; c < C; c++) {
        const y = this.delay[c][rd] * g;
        // Belt and braces: the construction above already guarantees this.
        ch[c][i] = y > 1 ? 1 : y < -1 ? -1 : y;
      }
      this.dpos = (this.dpos + 1) % this.dlen;
    }
    // Keep the index from growing without bound on a long show.
    if (this.n > 1e9) {
      const shift = this.n - this.L;
      for (let k = this.dqHead; k !== this.dqTail; k = (k + 1) % cap) this.dqIdx[k] -= shift;
      this.n -= shift;
    }
  }
}
return { Limiter };
})();

// ── src/audio/dsp/leveler.ts ──
const m_leveler = (() => {
/**
 * Level: a loudness AGC, then a gentle compressor, then a true-peak limiter.
 *
 * The AGC reads K-weighted loudness (BS.1770, as played: a mono file arrives
 * here up-mixed to two identical channels) and steers toward TARGET_LUFS:
 *
 *   - Slow path: the loudness of the last 3 s of *active* audio (100 ms
 *     blocks that pass the gate). Silence never drags it down, so a pause
 *     does not make the next word arrive boosted.
 *   - Fast path: the momentary (400 ms) loudness may sit at most
 *     momentaryHeadroom above the target. A hot caller trips it.
 *   - The gain rises slowly (riseTau, capped at riseCap dB/s) and falls
 *     fast (fallTau), within +MAX_BOOST / -MAX_CUT.
 *   - It freezes when the input is quiet (below -60 LUFS, or LEVEL_AGC.gateBelow
 *     under the active loudness): dead air and hiss are never pumped up.
 *   - It looks LOOKAHEAD_MS ahead: the audio is delayed, the detector is not,
 *     so the fall begins as the caller does rather than after.
 *
 * Everything here is pure and block-agnostic; the worklet and the offline
 * renderer drive the same code.
 */
const { Biquad, kWeighting } = m_biquad;
const { Compressor } = m_compressor;
const { Limiter } = m_limiter;
const TARGET_LUFS = -16;
const MAX_BOOST = 12;
const MAX_CUT = 10;
/**
 * The AGC's timing. Mutable only so the tuning script can try settings;
 * the app never changes it.
 *   riseTau/riseCap: how fast the gain climbs (s, dB/s)
 *   fallTau/fallCap: how fast it drops (s, dB/s)
 *   momentaryHeadroom: a 400 ms burst this far over the target cuts at once
 *   gateAbs/gateBelow: frozen below -60 LUFS, or this far under the talk
 *   talkerChangeDb: the newest second of talk this far from the 3 s mean is
 *     a new talker, and becomes the estimate (slowEstimate)
 */
const LEVEL_AGC = { riseTau: 1.0, riseCap: 6, fallTau: 0.3, fallCap: 30, momentaryHeadroom: 5, gateAbs: -60, gateBelow: 22, talkerChangeDb: 4 };
const LOOKAHEAD_MS = 200;
const CEILING_DBTP = -1.3; // the promise is -1 dBTP; a little margin
/**
 * The leveling compressor after the AGC (compressor.ts). The AGC sets each
 * 3 s to the target; this evens out the phrases inside them. Mutable only
 * so the tuning script can try settings; the app never changes it.
 */
const LEVEL_COMP = { thresholdDb: -30, ratio: 4, kneeDb: 10, attackMs: 20, releaseMs: 500, makeupDb: 10.5, rmsMs: 50, gateBelowDb: 7, kWeighted: true };
/** The AGC gain's per-sample smoothing time constant, seconds. */
const GAIN_SMOOTH_S = 0.02;

const HOP_MS = 25;
/** A talker change is judged on the newest second of talk (LEVEL_AGC.talkerChangeDb from the 3 s mean). */
const TALKER_CHANGE_BLOCKS = 10;
const BLOCK_MS = 100;

const lufs = (ms        ) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);

class Leveler {
           fs        ;
           latency        ;
          kw            ;
          hop        ;
          hopCount = 0;
          hopAcc = 0;
  /** Momentary: the last 16 hops (400 ms) of K-weighted mean square. */
          mom = new Float64Array(16);
          momPos = 0;
  /** Blocks of 100 ms being built from hops. */
          blockAcc = 0;
          blockHops = 0;
  /** The last 30 active 100 ms blocks (3 s of speech). */
          active = new Float64Array(30);
          activeN = 0;
          activePos = 0;
          gainDb        ;
          targetDb        ;
          frozen = false;
          lastBlockActive = false;
  /** Seconds of active audio measured since the last reset: fast acquisition until 3 s. */
          learned = 0;
          lastGain        ;
          smooth        ;
          delay                ;
          dpos = 0;
          dlen        ;
          look        ;
           comp            ;
           lim         ;
          cur              ;

  constructor(fs        , initialGainDb = 0) {
    this.fs = fs;
    this.kw = [0, 1].map(() => kWeighting(fs).map((c) => new Biquad(c)));
    this.hop = Math.round((HOP_MS / 1000) * fs);
    this.look = Math.round((LOOKAHEAD_MS / 1000) * fs);
    this.dlen = this.look + 1;
    this.delay = [new Float32Array(this.dlen), new Float32Array(this.dlen)];
    this.gainDb = this.targetDb = clamp(initialGainDb);
    this.lastGain = Math.pow(10, this.gainDb / 20);
    this.comp = new Compressor({ fs, ...LEVEL_COMP });
    this.smooth = 1 - Math.exp(-1 / (GAIN_SMOOTH_S * fs));
    this.lim = new Limiter({ fs, channels: 2, ceilingDb: CEILING_DBTP, lookaheadMs: 5, releaseMs: 80 });
    this.latency = this.look + this.lim.latency;
    this.cur = { gainDb: this.gainDb, targetDb: this.gainDb, frozen: false, activeLufs: -Infinity, momentaryLufs: -Infinity };
  }

  /** Forget the material (a seek, a new show) and start from `gainDb`. Never a blast: clamped. */
  reset(gainDb         = this.gainDb)       {
    this.mom.fill(0);
    this.momPos = 0;
    this.blockAcc = 0;
    this.blockHops = 0;
    this.active.fill(0);
    this.activeN = 0;
    this.activePos = 0;
    this.hopAcc = 0;
    this.hopCount = 0;
    this.learned = 0;
    this.lastBlockActive = false;
    this.gainDb = this.targetDb = clamp(gainDb);
    this.lastGain = Math.pow(10, this.gainDb / 20);
    for (const d of this.delay) d.fill(0);
    this.comp.reset();
    this.lim.reset();
  }

  /** Keep the measured history, change only the gain (a seek within the same show). */
  forgetHistory()       {
    const g = this.gainDb;
    this.reset(g);
  }

  state()               {
    return this.cur;
  }

          activeLufs()         {
    if (!this.activeN) return -Infinity;
    let s = 0;
    for (let i = 0; i < this.activeN; i++) s += this.active[i];
    return lufs(s / this.activeN);
  }

  /** The last `n` active blocks only (the newest talk). */
          recentLufs(n        )         {
    if (this.activeN < n) return -Infinity;
    let s = 0;
    for (let k = 1; k <= n; k++) s += this.active[(this.activePos - k + this.active.length) % this.active.length];
    return lufs(s / n);
  }

  /**
   * The slow path's estimate. The 3 s power mean, unless the newest second of
   * talk sits LEVEL_AGC.talkerChangeDb away from it: then someone else is talking
   * (the caller handed back to a quiet guest) and the newest second is the
   * estimate. A power mean is ruled by its loudest blocks, so after a loud
   * caller it held the gain down for most of 3 s, and the guest's first
   * sentences went by quiet.
   */
          slowEstimate(La        )         {
    const Lr = this.recentLufs(TALKER_CHANGE_BLOCKS);
    if (Lr > -Infinity && Math.abs(Lr - La) > LEVEL_AGC.talkerChangeDb) return Lr;
    return La;
  }

  /** One control step, every HOP_MS, on the detector (undelayed) side. */
          control(hopMs        )       {
    this.mom[this.momPos] = hopMs;
    this.momPos = (this.momPos + 1) % this.mom.length;
    let m = 0;
    for (let i = 0; i < this.mom.length; i++) m += this.mom[i];
    const Lm = lufs(m / this.mom.length);

    this.blockAcc += hopMs;
    if (++this.blockHops === BLOCK_MS / HOP_MS) {
      const bms = this.blockAcc / this.blockHops;
      this.blockAcc = 0;
      this.blockHops = 0;
      const Lb = lufs(bms);
      const La = this.activeLufs();
      this.lastBlockActive = Lb > LEVEL_AGC.gateAbs && (La === -Infinity || Lb > La - LEVEL_AGC.gateBelow);
      if (this.lastBlockActive) {
        this.active[this.activePos] = bms;
        this.activePos = (this.activePos + 1) % this.active.length;
        if (this.activeN < this.active.length) this.activeN++;
        this.learned += BLOCK_MS / 1000;
      }
    }
    const La = this.activeLufs();
    // Frozen in a pause: when the momentary loudness is quiet, or as soon as
    // the latest 100 ms block is (the momentary window still holds the last
    // words for 400 ms, and the gain kept climbing into the gap).
    this.frozen = !this.lastBlockActive || !(Lm > LEVEL_AGC.gateAbs && (La === -Infinity || Lm > La - LEVEL_AGC.gateBelow));
    const dt = HOP_MS / 1000;
    if (!this.frozen && La > -Infinity) {
      const slow = TARGET_LUFS - this.slowEstimate(La);
      const fast = TARGET_LUFS + LEVEL_AGC.momentaryHeadroom - Lm;
      this.targetDb = clamp(Math.min(slow, fast));
      const diff = this.targetDb - this.gainDb;
      // Acquisition: until 3 s of speech has been heard the estimate is
      // rough, and the start gain was a guess; let it rise faster then.
      const riseTau = this.learned < 3 ? 0.8 : LEVEL_AGC.riseTau;
      const riseCap = this.learned < 3 ? 8 : LEVEL_AGC.riseCap;
      let step = diff > 0 ? diff * (1 - Math.exp(-dt / riseTau)) : diff * (1 - Math.exp(-dt / LEVEL_AGC.fallTau));
      step = diff > 0 ? Math.min(step, riseCap * dt) : Math.max(step, -LEVEL_AGC.fallCap * dt);
      this.gainDb = clamp(this.gainDb + step);
    }
    this.cur = { gainDb: this.gainDb, targetDb: this.targetDb, frozen: this.frozen, activeLufs: La, momentaryLufs: Lm };
  }

  /** Measure only: the detector and the control loop, no audio touched. */
  measure(ch                , len        )       {
    const [l, r] = ch;
    const kL = this.kw[0];
    const kR = this.kw[1];
    let i = 0;
    while (i < len) {
      const n = Math.min(len - i, this.hop - this.hopCount);
      let acc = 0;
      for (let j = i; j < i + n; j++) {
        const a = kL[1].tick(kL[0].tick(l[j]));
        const b = kR[1].tick(kR[0].tick(r[j]));
        acc += a * a + b * b;
      }
      this.hopAcc += acc;
      this.hopCount += n;
      i += n;
      if (this.hopCount >= this.hop) {
        this.control(this.hopAcc / this.hopCount);
        this.hopAcc = 0;
        this.hopCount = 0;
      }
    }
  }

  /**
   * Process two channels in place. `amount` 0..1 blends the AGC gain in
   * (0 = unity, for a ramp on enable/disable); the compressor and limiter
   * always run so the stage's latency and ceiling never change.
   */
  process(ch                , len        , amount = 1)       {
    const [l, r] = ch;
    const kL = this.kw[0];
    const kR = this.kw[1];
    let i = 0;
    while (i < len) {
      const n = Math.min(len - i, this.hop - this.hopCount);
      // Detector side: K-weighted energy of the incoming (undelayed) audio.
      let acc = 0;
      for (let j = i; j < i + n; j++) {
        const a = kL[1].tick(kL[0].tick(l[j]));
        const b = kR[1].tick(kR[0].tick(r[j]));
        acc += a * a + b * b;
      }
      this.hopAcc += acc;
      this.hopCount += n;
      // Audio side: delay by the lookahead, the gain smoothed per sample
      // (a one-pole on the linear gain), so a control step never zippers.
      const target = Math.pow(10, (this.gainDb * amount) / 20);
      const a = this.smooth;
      let g = this.lastGain;
      for (let j = i; j < i + n; j++) {
        g += (target - g) * a;
        const rd = (this.dpos + 1) % this.dlen; // oldest sample: exactly `look` behind
        this.delay[0][this.dpos] = l[j];
        this.delay[1][this.dpos] = r[j];
        l[j] = this.delay[0][rd] * g;
        r[j] = this.delay[1][rd] * g;
        this.dpos = rd;
      }
      this.lastGain = g;
      i += n;
      if (this.hopCount >= this.hop) {
        this.control(this.hopAcc / this.hopCount);
        this.hopAcc = 0;
        this.hopCount = 0;
      }
    }
    this.comp.process(ch, len);
    this.lim.process(ch, len);
  }
}

function clamp(db        )         {
  return Math.max(-MAX_CUT, Math.min(MAX_BOOST, db));
}
return { TARGET_LUFS, MAX_BOOST, MAX_CUT, LEVEL_AGC, LOOKAHEAD_MS, CEILING_DBTP, LEVEL_COMP, Leveler };
})();

// ── src/audio/dsp/chain.ts ──
const m_chain = (() => {
/**
 * The whole processor: Clean up, then Level, at one constant latency.
 *
 *   input ─┬─ Clean up (wet) ─┐                      ┌─ Level ─┐
 *          └─ delay N ────────┴ mix(cleanupMix) ─┬───┤         ├ mix(levelMix) ─ duck ─ out
 *                                                └─ delay L ───┘
 *
 * Every switch is a ramp, and the latency never changes, so a toggle can
 * never click, pop or jump:
 *
 *   - A stage being switched on is *warmed* first: it runs, unheard, for its
 *     own latency (a cold gate or limiter would hand out silence for that
 *     long), and only then is it crossfaded in (CROSSFADE_MS).
 *   - Level's gain is then brought in over LEVEL_RAMP_MS, from unity, so its
 *     arrival is a gentle change of loudness, never a jump.
 *   - A stage switched off is crossfaded out, then stops running. With both
 *     off, this is a pure delay (and the host can take it out of the graph).
 *   - duck(): a seek or a new show. The output fades to silence over
 *     DUCK_MS and stays there until unduck() plus one full latency, so the
 *     old position's tail never plays after the jump; then it fades in.
 *
 * Level's measurement runs even while it is off, so switching it on starts
 * from the right gain for what is playing.
 */
const { Cleanup } = m_cleanup;
const { Leveler } = m_leveler;
const CROSSFADE_MS = 60;
const LEVEL_RAMP_MS = 800;
const DUCK_MS = 15;
const UNDUCK_MS = 40;

class DelayLine {
          buf                ;
          pos = 0;
          len        ;
  constructor(len        ) {
    this.len = len;
    this.buf = [new Float32Array(Math.max(1, len)), new Float32Array(Math.max(1, len))];
  }
  /** Write `src`, read the same count `len` samples older into `dst`. */
  run(src                , dst                , n        )       {
    if (this.len === 0) {
      dst[0].set(src[0].subarray(0, n));
      dst[1].set(src[1].subarray(0, n));
      return;
    }
    for (let i = 0; i < n; i++) {
      const p = this.pos;
      const a = this.buf[0][p];
      const b = this.buf[1][p];
      this.buf[0][p] = src[0][i];
      this.buf[1][p] = src[1][i];
      dst[0][i] = a;
      dst[1][i] = b;
      this.pos = (p + 1) % this.len;
    }
  }
  clear()       {
    for (const b of this.buf) b.fill(0);
  }
}

/** One stage's switch: off, warming (running, unheard), fading, on. */
class Switch {
  want = false;
  running = false;
  mix = 0;
          warm = 0;
          warmLen        ;
          step        ;
  constructor(warmLen        , step        ) {
    this.warmLen = warmLen;
    this.step = step;
  }
  set(on         )       {
    if (on && !this.want) {
      this.want = true;
      if (!this.running) {
        this.running = true;
        this.warm = this.warmLen;
      }
    } else if (!on) this.want = false;
  }
  /** The mix at the start of the block advance() just stepped (the end is `mix`). */
  m0 = 0;
  /** Advance by n samples (no allocation: read m0 and mix after). */
  advance(n        )       {
    this.m0 = this.mix;
    if (this.want) {
      if (this.warm > 0) this.warm = Math.max(0, this.warm - n);
      else this.mix = Math.min(1, this.mix + this.step * n);
    } else {
      this.mix = Math.max(0, this.mix - this.step * n);
      if (this.mix === 0) this.running = false;
    }
  }
  /** Ready to be heard immediately (the first show of a page with it on). */
  snapOn()       {
    this.want = this.running = true;
    this.warm = 0;
    this.mix = 1;
  }
}

class Chain {
           fs        ;
           latency        ;
           cleanup         ;
           level         ;
          cSw        ;
          lSw        ;
          dCleanup           ;
          dLevel           ;
          levelAmount = 0;
          levelWant = false;
          levelStep        ;
          duckGain = 1;
          duckTarget = 1;
          duckHold = 0;
          duckDown        ;
          duckUp        ;
          s                  ;

  constructor(fs        , opts                                                               = {}) {
    this.fs = fs;
    this.cleanup = new Cleanup(fs);
    this.level = new Leveler(fs, opts.startGainDb ?? 0);
    this.latency = this.cleanup.latency + this.level.latency;
    const step = 1 / ((CROSSFADE_MS / 1000) * fs);
    this.cSw = new Switch(this.cleanup.latency, step);
    this.lSw = new Switch(this.level.latency, step);
    this.dCleanup = new DelayLine(this.cleanup.latency);
    this.dLevel = new DelayLine(this.level.latency);
    this.levelStep = 1 / ((LEVEL_RAMP_MS / 1000) * fs);
    this.duckDown = 1 / ((DUCK_MS / 1000) * fs);
    this.duckUp = 1 / ((UNDUCK_MS / 1000) * fs);
    this.s = Array.from({ length: 3 }, () => [new Float32Array(128), new Float32Array(128)]);
    // At construction nothing has played: a stage asked for now is simply on.
    if (opts.cleanup) this.cSw.snapOn();
    if (opts.level) {
      this.levelWant = true;
      this.lSw.snapOn();
      this.levelAmount = 1;
    }
  }

  setLevel(on         )       {
    this.levelWant = on;
    if (on) this.lSw.set(true);
  }
  setCleanup(on         )       {
    this.cSw.set(on);
  }
  /** Both off and fully faded: nothing but delay lines are running. */
  idle()          {
    return !this.cSw.running && !this.lSw.running && !this.cSw.want && !this.levelWant;
  }

  /** Fade out now, for a jump in the input (a seek, a new show). */
  duck()       {
    this.duckTarget = 0;
    this.duckHold = Infinity;
  }
  /**
   * The jump has happened: once the old audio has drained (one full latency),
   * fade back in. `newShow` forgets what was learned; `startGainDb` is where
   * Level begins on it.
   */
  unduck(opts                                              = {})       {
    if (opts.newShow) {
      this.cleanup.resetAll();
      this.level.reset(opts.startGainDb ?? 0);
    } else {
      this.cleanup.resetPosition();
      this.level.forgetHistory();
    }
    this.dCleanup.clear();
    this.dLevel.clear();
    this.duckHold = this.latency;
  }

  status()              {
    const ls = this.level.state();
    const hum = this.cleanup.hum.status();
    return {
      level: { ...ls, on: this.levelWant, mix: this.lSw.mix, compGrDb: this.level.comp.gainReductionDb, limGainDb: 20 * Math.log10(this.level.lim.minGain) },
      cleanup: { on: this.cSw.want, mix: this.cSw.mix, music: this.cleanup.music.score, humFamily: hum.family, humLines: hum.lines.filter((l) => l.depth > 0.5).length },
      ducked: this.duckGain < 1,
    };
  }

          scratch(n        )       {
    if (this.s[0][0].length >= n) return;
    this.s = Array.from({ length: 3 }, () => [new Float32Array(n), new Float32Array(n)]);
  }

  /** Two channels in place, `n` samples. */
  process(ch                , n        )       {
    this.scratch(n);
    const [dry, wet, tmp] = this.s;

    // ── Clean up ──
    this.dCleanup.run(ch, dry, n);
    this.cSw.advance(n);
    const c0 = this.cSw.m0;
    const c1 = this.cSw.mix;
    if (this.cSw.running) {
      wet[0].set(ch[0].subarray(0, n));
      wet[1].set(ch[1].subarray(0, n));
      this.cleanup.process(wet, n);
      for (let i = 0; i < n; i++) {
        const m = c0 + ((c1 - c0) * (i + 1)) / n;
        ch[0][i] = dry[0][i] + m * (wet[0][i] - dry[0][i]);
        ch[1][i] = dry[1][i] + m * (wet[1][i] - dry[1][i]);
      }
    } else {
      ch[0].set(dry[0].subarray(0, n));
      ch[1].set(dry[1].subarray(0, n));
    }

    // ── Level ──
    // Off: its gain goes back to unity first (LEVEL_RAMP_MS / 2), and only
    // then is the stage crossfaded out. On: warmed, crossfaded in at unity,
    // then its gain comes in over LEVEL_RAMP_MS.
    if (!this.levelWant && this.levelAmount === 0) this.lSw.set(false);
    this.dLevel.run(ch, dry, n);
    this.lSw.advance(n);
    const l0 = this.lSw.m0;
    const l1 = this.lSw.mix;
    if (this.lSw.running) {
      if (this.levelWant && this.lSw.mix === 1) this.levelAmount = Math.min(1, this.levelAmount + this.levelStep * n);
      else if (!this.levelWant) this.levelAmount = Math.max(0, this.levelAmount - 2 * this.levelStep * n);
      tmp[0].set(ch[0].subarray(0, n));
      tmp[1].set(ch[1].subarray(0, n));
      this.level.process(tmp, n, this.levelAmount);
      for (let i = 0; i < n; i++) {
        const m = l0 + ((l1 - l0) * (i + 1)) / n;
        ch[0][i] = dry[0][i] + m * (tmp[0][i] - dry[0][i]);
        ch[1][i] = dry[1][i] + m * (tmp[1][i] - dry[1][i]);
      }
    } else {
      // Keep measuring (cheap: K-weighting only), so switching on starts
      // from the right gain. Not with both switches off: then nothing but
      // the delay lines runs (bypass means bypass), and Level, switched on
      // later, acquires from its start gain like a new show.
      if (this.cSw.running) this.level.measure(ch, n);
      ch[0].set(dry[0].subarray(0, n));
      ch[1].set(dry[1].subarray(0, n));
    }

    // ── Duck ──
    if (this.duckTarget === 0 || this.duckGain < 1) {
      for (let i = 0; i < n; i++) {
        if (this.duckHold !== Infinity && this.duckHold > 0) this.duckHold--;
        else if (this.duckHold === 0) this.duckTarget = 1;
        this.duckGain = this.duckTarget < this.duckGain ? Math.max(0, this.duckGain - this.duckDown) : Math.min(1, this.duckGain + this.duckUp);
        ch[0][i] *= this.duckGain;
        ch[1][i] *= this.duckGain;
      }
      if (this.duckTarget === 1 && this.duckGain === 1) this.duckHold = 0;
    }
  }
}
return { CROSSFADE_MS, LEVEL_RAMP_MS, DUCK_MS, UNDUCK_MS, Chain };
})();

// ── src/audio/dsp/worklet.ts ──
const m_worklet = (() => {
/**
 * The AudioWorklet processor: the Chain (Clean up, then Level), run on the
 * audio thread in 128-sample blocks. Built into public/audio/dsp-worklet.js
 * by scripts/audio/build-worklet.mjs (a test fails when that file is stale).
 *
 * Messages in (port):
 *   { type: "set", level, cleanup }           the listener's switches
 *   { type: "duck" }                           a seek or a new source is coming
 *   { type: "unduck", newShow, startGainDb }   it has arrived
 * Messages out:
 *   { type: "ready", latency }                 once, at construction
 *   { type: "status", blocks, inPeak, idle, ...ChainStatus }  every ~250 ms
 *
 * Both switches off: once the last fade has finished the chain is a pure
 * delay, and this copies its input through that delay and nothing else.
 */
const { Chain } = m_chain;

const PROCESSOR_NAME = "hd-dsp";

class DspProcessor extends AudioWorkletProcessor {
          chain       ;
          buf = [new Float32Array(128), new Float32Array(128)];
          blocks = 0;
          inPeak = 0;
          statusEvery        ;

  constructor(options      ) {
    super(options);
    const o = options?.processorOptions ?? {};
    this.chain = new Chain(sampleRate, { level: !!o.level, cleanup: !!o.cleanup, startGainDb: o.startGainDb ?? 0 });
    this.statusEvery = Math.max(1, Math.round((0.25 * sampleRate) / 128));
    this.port.onmessage = (e              ) => {
      const m = e.data;
      if (m?.type === "set") {
        this.chain.setLevel(!!m.level);
        this.chain.setCleanup(!!m.cleanup);
      } else if (m?.type === "duck") this.chain.duck();
      else if (m?.type === "unduck") this.chain.unduck({ newShow: !!m.newShow, startGainDb: typeof m.startGainDb === "number" ? m.startGainDb : undefined });
    };
    this.port.postMessage({ type: "ready", latency: this.chain.latency });
  }

  process(inputs                  , outputs                  )          {
    const input = inputs[0];
    const out = outputs[0];
    const n = out[0]?.length ?? 128;
    if (this.buf[0].length < n) this.buf = [new Float32Array(n), new Float32Array(n)];
    const [l, r] = this.buf;
    if (!input || input.length === 0) {
      l.fill(0, 0, n);
      r.fill(0, 0, n);
    } else {
      l.set(input[0].subarray(0, n));
      r.set((input[1] ?? input[0]).subarray(0, n));
    }
    let pk = this.inPeak;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(l[i]);
      if (a > pk) pk = a;
    }
    this.inPeak = pk;
    this.chain.process(this.buf, n);
    out[0].set(l.subarray(0, n));
    if (out[1]) out[1].set(r.subarray(0, n));
    if (++this.blocks % this.statusEvery === 0) {
      this.port.postMessage({ type: "status", blocks: this.blocks, inPeak: this.inPeak, idle: this.chain.idle(), ...this.chain.status() });
      this.inPeak = 0;
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, DspProcessor);
return { PROCESSOR_NAME };
})();
