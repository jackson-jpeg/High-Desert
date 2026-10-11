/**
 * The station's circuit breaker (2026-10-11).
 *
 * The station must never keep airing a show its listeners cannot play. When
 * BREAKER_CLIENTS distinct listeners tuned in to the station fail on the show
 * on the air within BREAKER_WINDOW_MS, the show is cut where it is: the
 * schedule ends its slot now and, after one station ID, plays a fan favorite
 * that passed its frame walk (pinned on the mirror first) to the slot's
 * original end. The trip is a row in `live_overrides`, applied at read time
 * by `applyOverrides`, so every client sees it on its next schedule read
 * (once a minute while tuned in; live-controller.ts restarts on a changed
 * slot) and the digest reports it.
 *
 * What counts: a failure the listener was left with (`recovered: false`), of
 * a kind about the file or the connection (COUNTED_KINDS), posted with
 * `live: true` by a tab tuned in to that very show. A browser refusing sound
 * (`play-rejected`, `handover-rejected`) is about the phone, not the show,
 * and a locked-phone handover burst must not knock a good show off the air.
 *
 * Who counts: the client key (`getClientKey`, the address bucket), HMAC'd
 * under a per-process random salt and held only in memory for the window.
 * Nothing about a listener is stored: the override row holds a count.
 */

import { createHmac, randomBytes } from "node:crypto";
import type { ProgramSlot } from "@/lib/live/schedule";

export const BREAKER_CLIENTS = 3;
export const BREAKER_WINDOW_MS = 2 * 60_000;
export const COUNTED_KINDS: ReadonlySet<string> = new Set(["timeout", "stall", "network-error", "decode-error", "empty-media"]);

export interface StationFailure {
  episodeId: string;
  /** The client key (never stored; hashed in memory). */
  client: string;
  kind: string;
  recovered: boolean;
  /** Posted by a tab tuned in to the station on this show. */
  live: boolean;
  at: number;
}

export interface Trip {
  slot: ProgramSlot;
  at: number;
  clients: number;
  kinds: string[];
}

export interface BreakerDeps {
  /** The slot on the air at `at`, or null between shows. */
  onAir(at: number): Promise<ProgramSlot | null>;
  /** Record the trip (the override). */
  trip(t: Trip): Promise<void>;
  clients?: number;
  windowMs?: number;
}

export function createBreaker(deps: BreakerDeps) {
  const need = deps.clients ?? BREAKER_CLIENTS;
  const windowMs = deps.windowMs ?? BREAKER_WINDOW_MS;
  const salt = randomBytes(32);
  const hash = (k: string) => createHmac("sha256", salt).update(k).digest("hex");
  /** slot key → client hash → [last failure at, kind] */
  const seen = new Map<string, Map<string, { at: number; kind: string }>>();
  const tripped = new Set<string>();

  function prune(now: number) {
    for (const [key, m] of seen) {
      for (const [c, v] of m) if (v.at < now - windowMs) m.delete(c);
      if (!m.size) seen.delete(key);
    }
  }

  return {
    /** A failure was reported. Resolves the trip it caused, if any. */
    async note(f: StationFailure): Promise<Trip | null> {
      if (!f.live || f.recovered || !COUNTED_KINDS.has(f.kind)) return null;
      const slot = await deps.onAir(f.at);
      if (!slot || slot.episodeId !== f.episodeId) return null;
      const key = `${slot.start}:${slot.fileHash}`;
      if (tripped.has(key)) return null;
      prune(f.at);
      const m = seen.get(key) ?? new Map<string, { at: number; kind: string }>();
      seen.set(key, m);
      m.set(hash(f.client), { at: f.at, kind: f.kind });
      if (m.size < need) return null;
      tripped.add(key);
      const t: Trip = { slot, at: f.at, clients: m.size, kinds: [...new Set([...m.values()].map((v) => v.kind))].sort() };
      seen.delete(key);
      await deps.trip(t);
      return t;
    },
    /** Tests: how many distinct clients are counted against a slot now. */
    count(slot: Pick<ProgramSlot, "start" | "fileHash">, now: number): number {
      prune(now);
      return seen.get(`${slot.start}:${slot.fileHash}`)?.size ?? 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

const KEY = Symbol.for("high-desert.live-breaker");

/** The process's breaker, reading the published schedule and writing `live_overrides`. */
export function stationBreaker(): ReturnType<typeof createBreaker> {
  const g = globalThis as unknown as Record<symbol, ReturnType<typeof createBreaker> | undefined>;
  return (g[KEY] ??= createBreaker({
    async onAir(at) {
      const { buildSchedule } = await import("@/services/live/days");
      const { scheduleContext } = await import("@/services/live/context");
      const s = await buildSchedule(at, scheduleContext);
      return "slot" in s.now ? s.now.slot : null;
    },
    trip: recordTrip,
  }));
}

async function recordTrip(t: Trip): Promise<void> {
  const { pool } = await import("@/services/stats/db/pool");
  const days = await import("@/services/live/days");
  const { pacificDay } = await import("@/lib/live/schedule");
  const day = pacificDay(t.slot.start);
  const program = await days.frozenDay(day);
  const checks = await days.loadAudioChecks();
  const { mirrorManifest } = await import("@/services/live/manifest");
  const pinned = (await mirrorManifest())?.fileHashes ?? null;
  const replacement = pickReplacement(program.ranking, t.slot.fileHash, checks.ok, checks.bad, pinned, new Set(program.slots.map((s) => s.fileHash)));
  await pool().query(
    `INSERT INTO live_overrides (slot_start, file_hash, day, cut_at, replacement, clients, kinds)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [t.slot.start, t.slot.fileHash, day, t.at, replacement, t.clients, t.kinds],
  );
  days.forgetOverrides();
  console.warn(
    `[live] breaker tripped: ${t.clients} listeners failed on ${t.slot.fileHash} (${t.kinds.join(",")}); ${replacement ? `${replacement} plays the rest of the slot` : "no verified show to put on: station ID to the next slot"}`,
  );
}

/**
 * The show to put on in a tripped slot's place: a fan favorite from the day's
 * ranking that passed its frame walk, pinned first, preferring one not on
 * today's program; never the failing file or a known-bad one.
 */
export function pickReplacement(
  ranking: readonly string[],
  failing: string,
  ok: ReadonlySet<string>,
  bad: ReadonlySet<string>,
  pinned: ReadonlySet<string> | null,
  today: ReadonlySet<string>,
): string | null {
  const fit = ranking.filter((h) => h !== failing && ok.has(h) && !bad.has(h));
  const order = [
    (h: string) => !!pinned?.has(h) && !today.has(h),
    (h: string) => !!pinned?.has(h),
    (h: string) => !today.has(h),
    () => true,
  ];
  for (const want of order) {
    const h = fit.find(want);
    if (h) return h;
  }
  return null;
}
