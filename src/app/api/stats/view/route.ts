import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { recordView } from "@/services/stats/store";
import { readJsonObject } from "@/lib/utils/json-body";
import { isArrivalSource, isUsageDevice, isUsageRoute } from "@/lib/usage/vocab";
import { isLook } from "@/lib/look/look";

/**
 * A tab entered (docs/usage-tracking.md).
 *
 * POST `{route, device, arrival?: {source, landing, look?}}`: adds one view to
 * `route_daily` for today (UTC), `route` one of welcome, library, radio, stats,
 * live, show, other, and `device` phone or desktop. `arrival` rides with a
 * browser session's first view: its coarse source (src/lib/usage/arrival.ts)
 * and the tab it landed on, counted in `arrival_daily`, with the look it landed
 * in (`win98`, `night`; anything else is stored unknown, never refused). An
 * arrival that is not well formed is dropped and the view still counted.
 * Returns `{ok}`.
 *
 * Nothing else is stored: no session, no address, no referrer, no id. Like
 * every other counter here it can be inflated by someone who wants to; it is
 * rate limited per client.
 */
export async function POST(request: NextRequest) {
  // A view is a tab entered and held for a second. Sixty a minute is a
  // household browsing quickly, and not much more.
  const rl = rateLimit(`stats-view:${getClientKey(request)}`, { maxRequests: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const { route, device, arrival } = parsed.body;
  if (!isUsageRoute(route)) {
    return NextResponse.json({ error: "route must be welcome, library, radio, stats, live, show or other" }, { status: 400 });
  }
  if (!isUsageDevice(device)) {
    return NextResponse.json({ error: "device must be phone or desktop" }, { status: 400 });
  }
  const a = arrival as { source?: unknown; landing?: unknown; look?: unknown } | null | undefined;
  const validArrival =
    a && typeof a === "object" && isArrivalSource(a.source) && isUsageRoute(a.landing)
      ? { source: a.source, landing: a.landing, look: isLook(a.look) ? a.look : null }
      : null;

  try {
    await recordView(route, device, validArrival);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/view] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
