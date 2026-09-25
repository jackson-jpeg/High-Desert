/**
 * How far this browser's clock is from the server's, NTP style.
 *
 * Everyone tuned in must hear the same second of the same show, and the only
 * shared reference is the server's clock: a slot starts at a server instant,
 * and a laptop whose clock is 40 s fast would otherwise join 40 s ahead of
 * everyone else.
 *
 * One sample is a request to `/api/live/time`: the browser notes `t0` before
 * it and `t1` after it, and the server answers with its own `now`. Assuming the
 * reply was stamped halfway through the round trip, the offset is
 * `server − (t0 + t1) / 2`, and it is wrong by at most half the round trip —
 * the unknowable asymmetry between the way there and the way back. So take
 * several samples and keep the one with the **smallest** round trip: its error
 * bound is the tightest. Averaging would let one slow, lopsided sample drag the
 * answer off by seconds.
 */

export interface ClockSample {
  /** Local `Date.now()` just before the request. */
  t0: number;
  /** Local `Date.now()` just after the response. */
  t1: number;
  /** The server's `now` from the response. */
  server: number;
}

export interface ClockEstimate {
  /** Add to local `Date.now()` to get server time. */
  offsetMs: number;
  /** The round trip of the sample it came from; the error is at most half this. */
  rttMs: number;
}

export function sampleOffset(s: ClockSample): number {
  return s.server - (s.t0 + s.t1) / 2;
}

/** The estimate from the lowest-RTT sample (the first of equals). Null with no usable sample. */
export function bestEstimate(samples: readonly ClockSample[]): ClockEstimate | null {
  let best: ClockSample | null = null;
  for (const s of samples) {
    const rtt = s.t1 - s.t0;
    if (!Number.isFinite(rtt) || rtt < 0 || !Number.isFinite(s.server)) continue;
    if (!best || rtt < best.t1 - best.t0) best = s;
  }
  return best ? { offsetMs: sampleOffset(best), rttMs: best.t1 - best.t0 } : null;
}

/** How many samples one sync takes. Each is one tiny GET. */
export const SYNC_SAMPLES = 5;

/**
 * Take `n` samples in sequence (never in parallel — concurrent requests queue
 * behind each other and every RTT is inflated) and return the best estimate.
 * Failed samples are skipped; null if none succeeded.
 */
export async function syncClock(
  fetchServerNow: () => Promise<number>,
  { n = SYNC_SAMPLES, now = () => Date.now() }: { n?: number; now?: () => number } = {},
): Promise<ClockEstimate | null> {
  const samples: ClockSample[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = now();
    try {
      const server = await fetchServerNow();
      samples.push({ t0, t1: now(), server });
    } catch {
      /* one lost sample is not a failed sync */
    }
  }
  return bestEstimate(samples);
}

/** `fetchServerNow` for the browser: GET /api/live/time. */
export async function fetchServerNow(): Promise<number> {
  const res = await fetch("/api/live/time", { cache: "no-store" });
  if (!res.ok) throw new Error(`live/time ${res.status}`);
  const body = (await res.json()) as { now?: unknown };
  if (typeof body.now !== "number") throw new Error("live/time: no clock");
  return body.now;
}
