import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { getFailureRates } from "@/services/stats/store";
import { withEpisodeInfo } from "@/services/stats/catalog";

/**
 * Which episodes are failing to start, worst first.
 *
 * Returns `{days, entries: [{episodeId, title, failures, recovered, plays,
 * rate, kinds, uaClasses, lastAt}]}`.
 *
 * Ids are resolved to titles here for the same reason /api/stats/export does
 * it: the admin panel is a list of *shows*, and a bare `ultimate-ultimate-art
 * -bell-collection--1997-09-05_...` key is not one.
 *
 * Not authenticated. The admin gate in the UI is presentation only — see
 * CLAUDE.md — so nothing may sit behind it that actually needs protecting.
 * This is aggregate operational data with no session, no ip and no user in it,
 * which is why it is safe to serve that way.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-failures:${ip}`, {
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  const daysParam = Number(request.nextUrl.searchParams.get("days") ?? 7);
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 7;

  try {
    const rows = await getFailureRates(days, 50);
    const entries = await withEpisodeInfo(rows);
    return NextResponse.json(
      { days, entries },
      // Short cache: this is a diagnostic view, not a live dashboard, and it
      // runs three aggregates over the failure table.
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (err) {
    console.warn(
      "[stats/failures] unavailable:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
