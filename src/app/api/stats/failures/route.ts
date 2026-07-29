import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { getFailureRates, getFailureSummary } from "@/services/stats/store";
import { withEpisodeInfo } from "@/services/stats/catalog";

/**
 * Which episodes are failing to start, worst first.
 *
 * Returns `{days, summary, entries: [{episodeId, title, failures, recovered,
 * skippedRetries, plays, rate, kinds, uaClasses, details, lastAt}]}`.
 *
 * `summary` is site-wide for the same window and is deliberately *not* a sum of
 * `entries`, which is capped at 50 episodes — summing it would under-report the
 * moment there are 51 and nothing would say so.
 *
 * `details` carries what the browser itself said (`MediaError.code` plus its
 * message). It was being stored and was only readable via psql, which is the
 * condition that let 33 phantom rows sit unexamined for four months.
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
    const [rows, summary] = await Promise.all([
      getFailureRates(days, 50),
      getFailureSummary(days),
    ]);
    const entries = await withEpisodeInfo(rows);
    return NextResponse.json(
      { days, summary, entries },
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
