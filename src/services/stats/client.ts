import { fetchWithRetry } from "@/lib/utils/retry";

const RETRY_OPTS = { retries: 1, timeout: 5000 } as const;

// ---------------------------------------------------------------------------
// Writes — fire-and-forget, never throw
// ---------------------------------------------------------------------------

export function reportPlay(episodeId: string, sessionId: string): void {
  fetch("/api/stats/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ episodeId, sessionId }),
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
  kind: "timeout" | "stall" | "play-rejected" | "network-error" | "decode-error";
  retried: boolean;
  /** True when a retry succeeded — the listener never saw a problem. */
  recovered: boolean;
  elapsedMs: number;
  uaClass: string;
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

/** The /api/stats/episodes route rejects more than this many ids per request. */
const MAX_COUNT_IDS = 100;

export async function fetchEpisodeCounts(
  ids: string[],
): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  try {
    // Hard cap: the route 400s above its limit, and an over-long query string is
    // rejected by proxies before it ever gets there.
    const capped = ids.slice(0, MAX_COUNT_IDS);
    const res = await fetchWithRetry(
      `/api/stats/episodes?ids=${capped.map(encodeURIComponent).join(",")}`,
      undefined,
      RETRY_OPTS,
    );
    if (!res.ok) return {};
    // Tolerate both `{counts:{...}}` and a bare map — deploys are not atomic, so a
    // cached client may talk to a newer route or vice versa.
    const data = await res.json();
    return data?.counts ?? data ?? {};
  } catch {
    return {};
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

export async function fetchActiveCount(): Promise<number> {
  try {
    const res = await fetchWithRetry(
      "/api/stats/active",
      undefined,
      RETRY_OPTS,
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return data.count ?? 0;
  } catch {
    return 0;
  }
}

export interface Presence {
  online: number;
  listening: number;
}

/** Who is on the site right now. Falls back to zeroes if stats are down. */
export async function fetchPresence(): Promise<Presence> {
  try {
    const res = await fetchWithRetry("/api/stats/active", undefined, RETRY_OPTS);
    if (!res.ok) return { online: 0, listening: 0 };
    const data = await res.json();
    return {
      online: data.online ?? data.count ?? 0,
      listening: data.listening ?? data.count ?? 0,
    };
  } catch {
    return { online: 0, listening: 0 };
  }
}

/** Mark this session present. Fire-and-forget, never throws. */
export function reportHeartbeat(sessionId: string): void {
  fetch("/api/stats/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {});
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
  onAir: OnAirEntry[];
  recent: RecentPlay[];
}

const EMPTY_NOW: NowPlaying = { online: 0, listening: 0, onAir: [], recent: [] };

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
      onAir: Array.isArray(data?.onAir) ? data.onAir : [],
      recent: Array.isArray(data?.recent) ? data.recent : [],
    };
  } catch {
    return EMPTY_NOW;
  }
}

export interface TrafficPoint {
  t: string;
  online: number;
  listening: number;
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
      points: Array.isArray(data?.points) ? data.points : [],
      hourly: Array.isArray(data?.hourly) ? data.hourly : [],
      peakAt: data?.peakAt ?? null,
    } as Traffic;
  } catch {
    return null;
  }
}
