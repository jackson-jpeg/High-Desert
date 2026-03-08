import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { getLeaderboard } from "@/services/stats/kv";

const VALID_PERIODS = new Set(["alltime", "week"]);

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-leaderboard:${ip}`, {
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const period = request.nextUrl.searchParams.get("period");
  if (!period || !VALID_PERIODS.has(period)) {
    return NextResponse.json(
      { error: 'Invalid period — must be "alltime" or "week"' },
      { status: 400 },
    );
  }

  try {
    const entries = await getLeaderboard(period as "alltime" | "week");
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("[stats/leaderboard] KV error:", err);
    return NextResponse.json(
      { error: "Stats service unavailable" },
      { status: 503 },
    );
  }
}
