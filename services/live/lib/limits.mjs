/**
 * The in-memory half of moderation: pace, duplicates, floods and slow mode.
 *
 * In memory because this is one long-lived process (like the app's
 * rate-limit.ts) and every check here runs on every post. A restart forgets
 * who posted in the last few seconds, which costs at most one early message
 * per caller. Mutes, bans and reports — the things that must survive a
 * restart — are in Postgres (store.mjs).
 *
 * Every map is pruned by `sweep()`, called on the service's minute timer, so
 * memory is bounded by the callers of the last ten minutes.
 */

import {
  BUSY_MESSAGES,
  BUSY_WINDOW_MS,
  DUPLICATE_MEMORY,
  DUPLICATE_WINDOW_MS,
  FLOOD_CLIENTS,
  FLOOD_MIN_CHARS,
  FLOOD_WINDOW_MS,
  POST_INTERVAL_MS,
  SLOW_INTERVAL_MS,
  SLOW_MODE_MS,
} from "./config.mjs";

export function createLimits({ now = Date.now } = {}) {
  /** ref → time of the last accepted post */
  const lastPost = new Map();
  /** ref → [{ key, at }] newest last */
  const recentBodies = new Map();
  /** dedup key → Map(ref → at) */
  const flood = new Map();
  /** times of accepted posts inside BUSY_WINDOW_MS */
  let busy = [];
  let autoUntil = 0;
  let forcedUntil = 0;

  function slowMode(t = now()) {
    const until = Math.max(autoUntil, forcedUntil);
    const on = until > t;
    return {
      on,
      until: on ? until : null,
      intervalMs: on ? SLOW_INTERVAL_MS : POST_INTERVAL_MS,
      forced: forcedUntil > t,
    };
  }

  /**
   * May `ref` post a message whose dedup key is `key` now?
   * @returns {{ ok: true } | { ok: false, status: 429, retryAfterMs: number } | { ok: false, status: 400, reason: "duplicate" }}
   */
  function pace(ref, t = now()) {
    const last = lastPost.get(ref);
    const interval = slowMode(t).intervalMs;
    if (last !== undefined && t - last < interval) {
      return { ok: false, status: 429, retryAfterMs: interval - (t - last) };
    }
    return { ok: true };
  }

  function duplicate(ref, key, t = now()) {
    const mine = recentBodies.get(ref) ?? [];
    if (mine.some((b) => b.key === key && t - b.at < DUPLICATE_WINDOW_MS)) return true;
    if (key.length >= FLOOD_MIN_CHARS) {
      const senders = flood.get(key);
      if (senders) {
        let others = 0;
        for (const [r, at] of senders) if (r !== ref && t - at < FLOOD_WINDOW_MS) others++;
        if (others >= FLOOD_CLIENTS - 1) return true;
      }
    }
    return false;
  }

  /** An accepted post. Returns true if this post turned automatic slow mode on. */
  function record(ref, key, t = now()) {
    lastPost.set(ref, t);
    const mine = (recentBodies.get(ref) ?? []).filter((b) => t - b.at < DUPLICATE_WINDOW_MS);
    mine.push({ key, at: t });
    recentBodies.set(ref, mine.slice(-DUPLICATE_MEMORY));
    if (key.length >= FLOOD_MIN_CHARS) {
      if (!flood.has(key)) flood.set(key, new Map());
      flood.get(key).set(ref, t);
    }
    busy.push(t);
    busy = busy.filter((x) => t - x < BUSY_WINDOW_MS);
    const wasOn = slowMode(t).on;
    if (busy.length > BUSY_MESSAGES) autoUntil = t + SLOW_MODE_MS;
    return !wasOn && slowMode(t).on;
  }

  function setForced(untilMs) {
    forcedUntil = untilMs ?? 0;
  }

  function sweep(t = now()) {
    for (const [ref, at] of lastPost) if (t - at > SLOW_INTERVAL_MS * 2) lastPost.delete(ref);
    for (const [ref, list] of recentBodies) {
      const keep = list.filter((b) => t - b.at < DUPLICATE_WINDOW_MS);
      if (keep.length) recentBodies.set(ref, keep);
      else recentBodies.delete(ref);
    }
    for (const [key, senders] of flood) {
      for (const [r, at] of senders) if (t - at >= FLOOD_WINDOW_MS) senders.delete(r);
      if (senders.size === 0) flood.delete(key);
    }
    busy = busy.filter((x) => t - x < BUSY_WINDOW_MS);
  }

  function size() {
    return { lastPost: lastPost.size, recentBodies: recentBodies.size, flood: flood.size };
  }

  return { pace, duplicate, record, slowMode, setForced, sweep, size };
}

/** A plain sliding-window counter: at most `max` events per `windowMs` per key. */
export function createWindowCounter({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  return {
    take(key, t = now()) {
      const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return { ok: false, retryAfterMs: windowMs - (t - list[0]) };
      }
      list.push(t);
      hits.set(key, list);
      return { ok: true };
    },
    sweep(t = now()) {
      for (const [k, list] of hits) {
        const keep = list.filter((x) => t - x < windowMs);
        if (keep.length) hits.set(k, keep);
        else hits.delete(k);
      }
    },
  };
}
