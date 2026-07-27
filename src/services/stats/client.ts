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

export function reportStop(sessionId: string): void {
  fetch("/api/stats/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
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
