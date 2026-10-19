import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp, getClientKey } from "@/lib/utils/rate-limit";
import { readJsonObject } from "@/lib/utils/json-body";
import { isLook } from "@/lib/look/look";
import { lookup } from "@/lib/geo/geoip";
import { isBotUserAgent } from "@/lib/utils/bot";
import { isCohortDay, isFunnelDevice, isVisitorId, recordVisit, visitorExists } from "@/services/stats/store";

/**
 * A browser was here (docs/visitors.md). Sent once per page load by
 * src/services/stats/visitor-client.ts.
 *
 * POST `{visitorId, device, look?, cohort?, cohortDevice?, cohortLook?,
 * hereBefore?}`. `visitorId` is the browser's own random id (16–64 of
 * `A-Za-z0-9_-`); `device` is `phone`/`desktop` now. `cohort`/`cohortDevice`/
 * `cohortLook` are the browser's funnel arrival, if it has one (what claims a
 * backfilled placeholder); `hereBefore: true` when the funnel excluded it for
 * arriving with a library. Returns `{ok, counted}`; `counted: false` for a
 * robot's user agent or a client past NEW_IDS_PER_HOUR new ids, which are
 * accepted and not stored. The address is looked up in the geo database
 * (country, region) and dropped: it is never stored.
 */
const NEW_IDS_PER_HOUR = 30;

function limited(key: string, maxRequests: number, windowMs = 60_000): NextResponse | null {
  const rl = rateLimit(key, { maxRequests, windowMs });
  if (rl.allowed) return null;
  return NextResponse.json(
    { error: "Rate limited" },
    { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
  );
}

export async function POST(request: NextRequest) {
  const client = getClientKey(request);
  const blocked = limited(`stats-visitor:${client}`, 20);
  if (blocked) return blocked;

  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const { visitorId, device, look, cohort, cohortDevice, cohortLook, hereBefore } = parsed.body;
  if (!isVisitorId(visitorId)) {
    return NextResponse.json({ error: "visitorId must be 16-64 of A-Z a-z 0-9 _ -" }, { status: 400 });
  }
  if (!isFunnelDevice(device)) {
    return NextResponse.json({ error: "device must be phone or desktop" }, { status: 400 });
  }
  if (isBotUserAgent(request.headers.get("user-agent"))) return NextResponse.json({ ok: true, counted: false });

  try {
    // A household or a carrier NAT is many browsers; a script minting ids is
    // many more. New ids past the cap are accepted and not counted.
    if (!(await visitorExists(visitorId))) {
      const rl = rateLimit(`stats-visitor-new:${client}`, { maxRequests: NEW_IDS_PER_HOUR, windowMs: 3_600_000 });
      if (!rl.allowed) return NextResponse.json({ ok: true, counted: false });
    }
    const hasCohort = isCohortDay(cohort);
    await recordVisit({
      id: visitorId,
      device,
      look: isLook(look) ? look : null,
      geo: lookup(getClientIp(request)),
      cohort: hasCohort ? cohort : null,
      cohortDevice: hasCohort && isFunnelDevice(cohortDevice) ? cohortDevice : null,
      cohortLook: hasCohort && isLook(cohortLook) ? cohortLook : null,
      hereBefore: hereBefore === true,
    });
    return NextResponse.json({ ok: true, counted: true });
  } catch (err) {
    console.error("[stats/visitor] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
