import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { getUsage } from "@/services/stats/store";

/**
 * Usage, aggregate only (docs/usage-tracking.md).
 *
 * GET `?days=7|30|90` (anything else is 7): `{days, routes: [{route, device,
 * views, minutes}], arrivals: [{source, landing, device, look, n}],
 * playsBySurface: {library, radio, live, stats, show, palette, queue, restore,
 * other, unknown}, playsByLook: {win98, night, unknown}}`. `look` is the look a
 * session landed in (null before 2026-10-12). Days are UTC days, today
 * included. `no-store`.
 */
export async function GET(request: NextRequest) {
  const rl = rateLimit(`stats-usage-read:${getClientKey(request)}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  const daysParam = Number(request.nextUrl.searchParams.get("days") ?? 7);
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 7;
  try {
    return NextResponse.json(await getUsage(days), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[stats/usage] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
