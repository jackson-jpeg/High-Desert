import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { getRecords } from "@/services/stats/store";
import { withEpisodeInfo } from "@/services/stats/catalog";

/**
 * The records (docs/visitors.md). GET → `{biggestCrowd: {online, listening,
 * at, day, since}, biggestDay: {day, plays}, biggestArrivalDay: {day,
 * visitors}, mostPlayed: {episodeId, plays, title}}`, each null when there is
 * nothing yet.
 *
 * - `biggestCrowd`: the most people online at once (a 2-minute sample's
 *   distinct clients), from `since` (2026-09-24), the day `online` began
 *   counting people and not page loads; `at` is the instant it was reached.
 * - `biggestDay`: the most plays in one UTC day (traffic_daily).
 * - `biggestArrivalDay`: the most new browsers in one UTC day (the funnel).
 * - `mostPlayed`: the all-time counter, the same as the leaderboard's first row.
 *
 * Cached 60 s at the proxy, 30/min.
 */
export async function GET(request: NextRequest) {
  const rl = rateLimit(`stats-records:${getClientKey(request)}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  try {
    const r = await getRecords();
    const mostPlayed = r.mostPlayed
      ? await withEpisodeInfo([r.mostPlayed]).then(([e]) => ({ episodeId: e.episodeId, plays: e.plays, title: e.title }))
      : null;
    return NextResponse.json({ ...r, mostPlayed }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (err) {
    console.error("[stats/records] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
