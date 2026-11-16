/**
 * Two-pass Level in the browser (docs/audio-processing/README.md, "Two-pass
 * Level"): fetch a show's envelope (GET /api/level/envelope) and drive a
 * GainNode from it, scheduled against the element's playback position.
 *
 * The schedule is a short horizon of linear ramps, one per envelope point,
 * mapped from file time to context time at the element's playback rate. It
 * is laid again from the element's position on every timeupdate (about four
 * times a second), seek, rate change, play and pause, so the two clocks can
 * never drift apart by more than a quarter second's worth, and a paused
 * element holds its gain. No lookahead: nothing is delayed.
 */
import { gainAt, unpackEnvelope, type Envelope } from "@/lib/audio/level-envelope";

export const ENVELOPE_URL = "/api/level/envelope";
/** How far ahead, in file seconds, each sync schedules. */
export const HORIZON_SEC = 2;
/** The handover between the live leveler and the envelope, both ways (seconds). */
export const HANDOVER_SEC = 0.3;
/** A show with no envelope yet is asked again after this. */
export const MISS_RETRY_MS = 10 * 60_000;

const dbToLin = (db: number) => Math.pow(10, db / 20);

/** The subset of AudioParam the schedule uses (a fake in the tests). */
export interface ParamLike {
  cancelScheduledValues(t: number): unknown;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
}

/**
 * Lay the schedule: the gain at `pos` now, then a ramp to each envelope point
 * within the horizon. Paused (or rate 0): hold the gain at `pos`. Returns the
 * gain set now (dB), for the meter.
 */
export function scheduleEnvelope(param: ParamLike, env: Envelope, o: { now: number; pos: number; rate: number; playing: boolean; horizonSec?: number }): number {
  const g0 = gainAt(env, o.pos);
  param.cancelScheduledValues(o.now);
  param.setValueAtTime(dbToLin(g0), o.now);
  if (!o.playing || !(o.rate > 0)) return g0;
  const end = o.pos + (o.horizonSec ?? HORIZON_SEC) * o.rate;
  const first = Math.max(0, Math.floor((o.pos - env.offsetSec) / env.hopSec) + 1);
  for (let k = first; k < env.gainDb.length; k++) {
    const t = env.offsetSec + k * env.hopSec;
    if (t > end) break;
    param.linearRampToValueAtTime(dbToLin(env.gainDb[k]), o.now + (t - o.pos) / o.rate);
  }
  return g0;
}

/** Ramp from the current gain to `toDb` over HANDOVER_SEC (a handover, or Level going off). */
export function rampTo(param: ParamLike & { value?: number }, toDb: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value ?? 1, now);
  param.linearRampToValueAtTime(dbToLin(toDb), now + HANDOVER_SEC);
}

type Entry = { env: Envelope | null; at: number } | Promise<Envelope | null>;
const cache = new Map<string, Entry>();

/** The envelope for a community key: cached, a miss asked again after MISS_RETRY_MS. */
export function loadEnvelope(key: string, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<Envelope | null> {
  const hit = cache.get(key);
  if (hit instanceof Promise) return hit;
  if (hit && (hit.env || now - hit.at < MISS_RETRY_MS)) return Promise.resolve(hit.env);
  const p = (async () => {
    try {
      const res = await fetchFn(`${ENVELOPE_URL}?key=${encodeURIComponent(key)}`);
      if (!res.ok) return null;
      return unpackEnvelope(await res.arrayBuffer());
    } catch {
      return null;
    }
  })().then((env) => {
    cache.set(key, { env, at: Date.now() });
    return env;
  });
  cache.set(key, p);
  return p;
}

/** The envelope for `key` if it is already here (synchronous: the play path never waits). */
export function envelopeIfLoaded(key: string | null): Envelope | null {
  if (!key) return null;
  const hit = cache.get(key);
  return hit && !(hit instanceof Promise) ? hit.env : null;
}

/** Test-only. */
export function __resetEnvelopeCache(): void {
  cache.clear();
}
