import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { getPresence } from "@/services/stats/store";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-active:${ip}`, {
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const { online, listening } = await getPresence();
    // `count` is retained and still means "listening". Existing clients read
    // it, and this file's history is the reason CLAUDE.md warns about response
    // shapes here — a mismatch once made every play count read as 0 for months.
    return NextResponse.json({ count: listening, online, listening });
  } catch (err) {
    console.error("[stats/active] store error:", err);
    return NextResponse.json(
      { error: "Stats service unavailable" },
      { status: 503 },
    );
  }
}
