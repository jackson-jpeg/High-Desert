import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { getNowPlaying } from "@/services/stats/store";

/**
 * What the community is doing right now.
 *
 * Response shape:
 *   { online, listening,
 *     onAir:  [{ episodeId, listeners }],
 *     recent: [{ episodeId, at }] }
 *
 * A superset of /api/stats/active, which is kept for the shell's heartbeat
 * loop — that runs on every route and has no use for the episode lists.
 *
 * Never cached: a stale "on air" list is worse than none, since the whole
 * point is that it moves. The underlying queries are two indexed reads.
 *
 * Aggregate only. `onAir` rows are episode ids with counts, and `recent` holds
 * no session id at all, so nothing here can be tied back to a visitor.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-now:${ip}`, {
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const now = await getNowPlaying();
    return NextResponse.json(now, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[stats/now] store error:", err);
    return NextResponse.json(
      { error: "Stats service unavailable" },
      { status: 503 },
    );
  }
}
