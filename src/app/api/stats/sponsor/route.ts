import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { readJsonObject } from "@/lib/utils/json-body";
import { isSponsorId } from "@/lib/support/sponsors";
import { SURFACE_EVENTS, isSponsorEvent, isSponsorSurface, recordSponsorEvent } from "@/services/stats/db/sponsors";

/**
 * One station-sponsor impression or click (docs/station-breaks.md).
 *
 * POST `{app, surface, event}`: `app` sogojet, screenreceipts or simsunday;
 * `surface` air (the spot played to a tuned-in listener), chat (the station
 * break card) or stats (the /stats panel); `event` heard (air only), seen,
 * click (the App Store link) or mute (chat only). Adds one to
 * `sponsor_daily` for today (UTC). Returns `{ok}`; 400 on anything else.
 * No session, no address, no id. Rate limited per client.
 */
export async function POST(request: NextRequest) {
  const rl = rateLimit(`stats-sponsor:${getClientKey(request)}`, { maxRequests: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const { app, surface, event } = parsed.body;
  if (!isSponsorId(app)) return NextResponse.json({ error: "unknown app" }, { status: 400 });
  if (!isSponsorSurface(surface) || !isSponsorEvent(event) || !SURFACE_EVENTS[surface].includes(event)) {
    return NextResponse.json({ error: "unknown surface or event" }, { status: 400 });
  }
  try {
    await recordSponsorEvent(app, surface, event);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/sponsor] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
