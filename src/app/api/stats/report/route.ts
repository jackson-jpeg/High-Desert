import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { getRatingsReport } from "@/services/stats/db/report";
import { withEpisodeInfo } from "@/services/stats/catalog";
import { usStateCode } from "@/lib/geo/places";

/**
 * The ratings report on /stats (UI plan push 6, batch 4).
 * GET → `{crowd: {peak, typical, days} | null, week: [{episodeId, plays,
 * title}], newStates: [{region, code}], finished: {since, minPlays,
 * entries: [{episodeId, plays, finishes, share, title}]}}`. `crowd` is the
 * last 12 hours' peak online against the median daily peak of the 28 days
 * before today, null under 7 days of peaks; `week` the 5 most played shows of
 * the last 7 days (2+ plays; the first is the hottest); `newStates` US states whose first browser came
 * this week; `finished` the shows most often heard to the end since `since`,
 * among those with `minPlays`+ plays. `max-age=60`, 30/min.
 */
export async function GET(request: NextRequest) {
  const rl = rateLimit(`stats-report:${getClientKey(request)}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  try {
    const r = await getRatingsReport();
    const week = await withEpisodeInfo(r.week);
    const entries = await withEpisodeInfo(r.finished.entries);
    return NextResponse.json(
      {
        crowd: r.crowd,
        week: week.map((e) => ({ episodeId: e.episodeId, plays: e.plays, title: e.title })),
        newStates: r.newStates.map((region) => ({ region, code: usStateCode(region) })),
        finished: {
          since: r.finished.since,
          minPlays: r.finished.minPlays,
          entries: entries.map((e) => ({ episodeId: e.episodeId, plays: e.plays, finishes: e.finishes, share: e.share, title: e.title })),
        },
      },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (err) {
    console.error("[stats/report] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
