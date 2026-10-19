import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { getTuneIns } from "@/services/stats/store";
import { GEO_ATTRIBUTION, countryName, usStateCode } from "@/lib/geo/places";

/**
 * "Tuning in from": the last 10 tune-ins to the live station and where they
 * resolved to (docs/visitors.md). GET → `{entries: [{at, country, name,
 * region, code, city}], attribution}`, newest first. `city` is null unless the
 * geo database vouched for it (an accuracy radius within 50 km; DB-IP Lite
 * gives none, so with it always null). One line per client per half hour.
 * `no-store`, 60/min.
 */
export async function GET(request: NextRequest) {
  const rl = rateLimit(`stats-tuning-in:${getClientKey(request)}`, { maxRequests: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  try {
    const entries = (await getTuneIns()).map((t) => ({
      at: t.at,
      country: t.country,
      name: countryName(t.country),
      region: t.region,
      code: t.country === "US" ? usStateCode(t.region) : null,
      city: t.city,
    }));
    return NextResponse.json({ entries, attribution: GEO_ATTRIBUTION }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[stats/tuning-in] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
