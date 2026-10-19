import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { getVisitorLocations, getVisitorTotals, type LocationBreakdown } from "@/services/stats/store";
import { GEO_ATTRIBUTION, countryName, usStateCode } from "@/lib/geo/places";

/**
 * Unique visitors, all time, and where they are (docs/visitors.md).
 *
 * GET → `{countingSince, totals: {visitors, browsers, backfilled, hereBefore,
 * newThisWeek, activeThisWeek, returning}, locations: {allTime, week, now},
 * attribution}`. Each of `allTime`/`week`/`now` is `{total, countries:
 * [{country, name, n}], states: [{region, code, n}]}`, largest first with the
 * unknown bucket (`country`/`region` null) last. `states` is the United
 * States only. `allTime` is every browser by its latest location (backfilled
 * arrivals have none: they are the unknown bucket); `week` the browsers seen
 * in the last 7 days; `now` the people online (the presence set, distinct
 * clients). `visitors` counts every browser once since `countingSince`, plus
 * the browsers from before it that have come back since (`hereBefore`).
 * `no-store`, 30/min.
 */
function shape(b: LocationBreakdown) {
  return {
    total: b.total,
    countries: b.countries.map((c) => ({ country: c.country, name: countryName(c.country), n: c.n })),
    states: b.states.map((s) => ({ region: s.region, code: usStateCode(s.region), n: s.n })),
  };
}

export async function GET(request: NextRequest) {
  const rl = rateLimit(`stats-visitors-read:${getClientKey(request)}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  try {
    const [totals, locations] = await Promise.all([getVisitorTotals(), getVisitorLocations()]);
    const { countingSince, ...rest } = totals;
    return NextResponse.json(
      {
        countingSince,
        totals: rest,
        locations: { allTime: shape(locations.allTime), week: shape(locations.week), now: shape(locations.now) },
        attribution: GEO_ATTRIBUTION,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[stats/visitors] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
