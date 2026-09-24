import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { getPresence } from "@/services/stats/store";

/**
 * Legacy alias. No surface in this build reads it — every presence number on
 * the site comes from /api/stats/now through one shared client feed
 * (`src/services/stats/now-feed.ts`). It stays so a tab still running an older
 * build keeps working, and it serves the same getPresence() result, so it
 * cannot disagree with /now either.
 */
export async function GET(request: NextRequest) {
  const ip = getClientKey(request);
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
