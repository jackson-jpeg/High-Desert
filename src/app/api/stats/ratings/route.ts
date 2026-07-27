import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { getRatings } from "@/services/stats/kv";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-ratings:${ip}`, {
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json({ error: "ids parameter required" }, { status: 400 });
  }

  const ids = idsParam.split(",").filter(Boolean).slice(0, 50); // max 50 at once
  if (ids.length === 0) {
    return NextResponse.json({});
  }

  try {
    const ratings = await getRatings(ids);
    return NextResponse.json(ratings);
  } catch (err) {
    console.error("[stats/ratings] KV error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
