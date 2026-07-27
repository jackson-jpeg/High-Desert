import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { getTraffic, type TrafficRange } from "@/services/stats/store";

const VALID_RANGES = new Set<TrafficRange>(["24h", "7d", "30d"]);

/**
 * Public traffic history.
 *
 * Response shape:
 *   { range, points: [{ t, online, listening, plays }],
 *     peakOnline, peakListening, playsInRange, totalPlays, peakAt,
 *     hourly: [{ hour, online, listening, plays }] }
 *
 * `hourly` is always a 24-entry, zero-filled, UTC-hour profile over the last
 * 30 days — it does not vary with `range`, and the client rotates it into
 * local time.
 *
 * `points` is bucketed server-side (15m / 2h / 6h by range) so the client never
 * has to thin it. Cached briefly at the edge — the sampler only writes every
 * couple of minutes, so a fresh query per viewer buys nothing.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-traffic:${ip}`, {
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const raw = request.nextUrl.searchParams.get("range") ?? "24h";
  if (!VALID_RANGES.has(raw as TrafficRange)) {
    return NextResponse.json(
      { error: 'Invalid range — must be "24h", "7d" or "30d"' },
      { status: 400 },
    );
  }

  try {
    const traffic = await getTraffic(raw as TrafficRange);
    return NextResponse.json(traffic, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (err) {
    console.error("[stats/traffic] store error:", err);
    return NextResponse.json(
      { error: "Stats service unavailable" },
      { status: 503 },
    );
  }
}
