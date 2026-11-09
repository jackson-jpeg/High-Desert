import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { sponsorTotals } from "@/services/stats/db/sponsors";

const DAYS = new Set([7, 30, 90]);

/**
 * Station sponsors, aggregate only (docs/station-breaks.md). `?days=7|30|90`
 * (else 30) → `{days, apps: [{app, heard, seenChat, seenStats, clicksChat,
 * clicksStats, mutes}]}`, UTC days, today included. `no-store`, 30/min. Read
 * by `highdesert-status`'s `sponsors` line and the /stats panel in admin mode.
 */
export async function GET(request: NextRequest) {
  const rl = rateLimit(`stats-sponsors:${getClientKey(request)}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  const asked = Number(request.nextUrl.searchParams.get("days"));
  const days = DAYS.has(asked) ? asked : 30;
  try {
    const apps = await sponsorTotals(days);
    return NextResponse.json({ days, apps }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[stats/sponsors] error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
