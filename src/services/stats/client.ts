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

export async function fetchEpisodeCounts(
  ids: string[],
): Promise<Record<string, number>> {
  try {
    const res = await fetchWithRetry(
      `/api/stats/episodes?ids=${ids.join(",")}`,
      undefined,
      RETRY_OPTS,
    );
    if (!res.ok) return {};
    return await res.json();
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
    return await res.json();
  } catch {
    return [];
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
