import { fetchWithRetry } from "@/lib/utils/retry";
import type { FailureKind } from "@/audio/playback-watchdog";
import type { SourceKind } from "@/audio/sources";

const RETRY_OPTS = { retries: 1, timeout: 5000 } as const;

// ---------------------------------------------------------------------------
// Writes — fire-and-forget, never throw
// ---------------------------------------------------------------------------

/** `source`: which host the listen is coming from (src/audio/sources.ts). */
export function reportPlay(episodeId: string, sessionId: string, source?: SourceKind | null): void {
  fetch("/api/stats/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ episodeId, sessionId, ...(source ? { source } : {}) }),
  }).catch(() => {});
}

/**
 * Playback stopped. `keepPresence` leaves the session in the online count —
 * stopping a track is not leaving the site, and dropping the row here would
 * have removed the visitor from "online" while they carried on browsing.
 */
export function reportStop(sessionId: string, keepPresence = true): void {
  fetch("/api/stats/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, keepPresence }),
  }).catch(() => {});
}

export interface PlaybackFailure {
  episodeId: string;
  /**
   * Sourced from the watchdog rather than re-listed here. The two copies drifted
   * the moment a kind was added, and a duplicated union fails at the call site
   * rather than at the definition — which reads like the caller is wrong.
   */
  kind: FailureKind;
  retried: boolean;
  /** True when a retry succeeded — the listener never saw a problem. */
  recovered: boolean;
  elapsedMs: number;
  uaClass: string;
  /**
   * Free-text context for advisory rows, currently only the duration
   * `loadedmetadata` reported for an `empty-media-suspected`. Deliberately not a
   * reuse of `elapsedMs`, which means "how long the listener waited" everywhere
   * else and would have poisoned the failures view's timing column.
   */
  detail?: string;
  /** The host that failed (src/audio/sources.ts). */
  source?: SourceKind;
}

/**
 * A show failed to start. Fire-and-forget, like reportPlay.
 *
 * Carries no session id and no identifier of any kind beyond the episode and a
 * coarse platform bucket. The point is to turn "it's a bit consistent for me"
 * into a ranked list of specific episodes, which needs counts per episode and
 * nothing per person.
 */
export function reportPlaybackFailure(failure: PlaybackFailure): void {
  fetch("/api/playback-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(failure),
    // A failure reported at the moment the user gives up and closes the tab is
    // the most interesting kind, and is exactly the one a plain fetch drops.
    keepalive: true,
  }).catch(() => {});
}

export function reportStopBeacon(sessionId: string): void {
  const body = JSON.stringify({ sessionId });
  const blob = new Blob([body], { type: "application/json" });

  const sent = navigator.sendBeacon("/api/stats/stop", blob);
  if (!sent) {
    fetch("/api/stats/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Reads — graceful failure with fallback values
// ---------------------------------------------------------------------------

export interface CommunityNumbers {
  plays: number;
  /** Mean community rating; 0 when unrated. */
  avg: number;
  /** Ratings behind `avg`. */
  count: number;
}

/**
 * Community plays and ratings for the whole catalog, keyed by community key.
 * Null when stats are unavailable — distinct from "loaded, and nobody has
 * played anything", which is an empty object.
 */
export async function fetchCommunityCatalog(): Promise<Record<string, CommunityNumbers> | null> {
  try {
    const res = await fetchWithRetry("/api/stats/community", undefined, RETRY_OPTS);
    if (!res.ok) return null;
    const data = await res.json();
    const episodes = data?.episodes;
    return episodes && typeof episodes === "object" ? episodes : null;
  } catch {
    return null;
  }
}

export async function fetchLeaderboard(
  period: "alltime" | "week",
): Promise<{ episodeId: string; plays: number }[]> {
  try {
    const res = await fetchWithRetry(
      `/api/stats/leaderboard?period=${period}`,
      undefined,
      RETRY_OPTS,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.entries ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

/** Fire-and-forget: submit a community rating (1-5) or null to remove. */
export function reportRating(episodeId: string, rating: number | null): void {
  fetch("/api/stats/rate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ episodeId, rating }),
  }).catch(() => {});
}

/** Fetch community ratings for a batch of episode IDs. */
export async function fetchRatings(
  ids: string[],
): Promise<Record<string, { avg: number; count: number }>> {
  if (ids.length === 0) return {};
  try {
    // The route caps at 50 ids per request.
    const capped = ids.slice(0, 50);
    const res = await fetchWithRetry(
      `/api/stats/ratings?ids=${capped.map(encodeURIComponent).join(",")}`,
      undefined,
      RETRY_OPTS,
    );
    if (!res.ok) return {};
    const data = await res.json();
    return data?.ratings ?? data ?? {};
  } catch {
    return {};
  }
}

export interface Presence {
  online: number;
  listening: number;
}

/**
 * Mark this session present. Never rejects: resolves once the beat has landed
 * (or failed), so the caller can refresh the presence feed after it.
 *
 * `episodeId` is sent only while something is actually playing, and renews the
 * listening mark that puts a show on air. Without it the mark was written once
 * at play time and expired five minutes later, mid-broadcast.
 */
export function reportHeartbeat(
  sessionId: string,
  episodeId?: string | null,
  /** Tuned in to the live station. Sent only when true; its absence clears the mark. */
  live = false,
): Promise<void> {
  return fetch("/api/stats/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      ...(episodeId ? { episodeId } : {}),
      ...(live ? { live: true } : {}),
    }),
  }).then(
    () => {},
    () => {},
  );
}

export interface OnAirEntry {
  episodeId: string;
  listeners: number;
}

export interface RecentPlay {
  episodeId: string;
  at: string;
}

export interface NowPlaying extends Presence {
  /** Of `online`, the clients tuned in to the live station. */
  live: number;
  onAir: OnAirEntry[];
  recent: RecentPlay[];
}

const EMPTY_NOW: NowPlaying = { online: 0, listening: 0, live: 0, onAir: [], recent: [] };

/**
 * Presence plus what is playing. Falls back to empty — with DATABASE_URL unset
 * this route 503s by design and the panel hides itself.
 *
 * The arrays are defaulted individually rather than by spreading the response:
 * an older deploy answers this shape without them, and `.map` on undefined
 * would take the panel down inside its error boundary.
 */
export async function fetchNowPlaying(): Promise<NowPlaying> {
  try {
    const res = await fetchWithRetry("/api/stats/now", undefined, RETRY_OPTS);
    if (!res.ok) return EMPTY_NOW;
    const data = await res.json();
    return {
      online: data?.online ?? 0,
      listening: data?.listening ?? 0,
      // Absent from a server that predates the live station: nobody tuned in.
      live: typeof data?.live === "number" ? data.live : 0,
      onAir: Array.isArray(data?.onAir) ? data.onAir : [],
      recent: Array.isArray(data?.recent) ? data.recent : [],
    };
  } catch {
    return EMPTY_NOW;
  }
}

export interface TrafficPoint {
  t: string;
  /** The bucket's mean — the level. */
  online: number;
  listening: number;
  /** The bucket's highest sample — the spike. What the chart's main lines draw. */
  onlineMax: number;
  listeningMax: number;
  plays: number;
}

export interface HourBucket {
  /** UTC hour, 0-23. */
  hour: number;
  online: number;
  listening: number;
  plays: number;
  /** Samples behind this hour. 0 = never observed, not "nobody was here". */
  samples: number;
}

export interface Traffic {
  range: string;
  points: TrafficPoint[];
  peakOnline: number;
  peakListening: number;
  playsInRange: number;
  totalPlays: number;
  peakAt: string | null;
  hourly: HourBucket[];
}

/** Bucketed traffic history. Returns null when stats are unavailable. */
export async function fetchTraffic(
  range: "24h" | "7d" | "30d",
): Promise<Traffic | null> {
  try {
    const res = await fetchWithRetry(
      `/api/stats/traffic?range=${range}`,
      undefined,
      RETRY_OPTS,
    );
    if (!res.ok) return null;
    const data = await res.json();
    // Same reasoning as fetchNowPlaying: `hourly` and `peakAt` post-date the
    // original route, and a client cached from an earlier deploy must not
    // crash on their absence.
    return {
      ...data,
      // A server from before per-bucket maxima sends only the means; draw
      // those as the max rather than a flat zero line.
      points: Array.isArray(data?.points)
        ? data.points.map((p: TrafficPoint) => ({
            ...p,
            onlineMax: typeof p.onlineMax === "number" ? p.onlineMax : p.online,
            listeningMax: typeof p.listeningMax === "number" ? p.listeningMax : p.listening,
          }))
        : [],
      hourly: Array.isArray(data?.hourly) ? data.hourly : [],
      peakAt: data?.peakAt ?? null,
    } as Traffic;
  } catch {
    return null;
  }
}
