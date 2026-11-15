import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { readJsonObject } from "@/lib/utils/json-body";
import { isDspEvent } from "@/lib/audio/dsp-events";
import { dspTotals, recordDspEvent } from "@/services/stats/db/dsp";

const DAYS = new Set([7, 30, 90]);

/**
 * Level and Clean up, counted (docs/audio-processing/README.md).
 *
 * POST `{event}`, one of DSP_EVENTS (src/lib/audio/dsp-events.ts): adds one
 * to `dsp_daily` for today (UTC). Returns `{ok}`; 400 on anything else.
 * No session, no address, no id. 30/min per client.
 *
 * GET `?days=7|30|90` (else 7) → `{days, events: {event: n}}`, every event,
 * zeros included. `no-store`, 30/min. Read by highdesert-status's `dsp` line.
 */
export async function POST(request: NextRequest) {
  const rl = rateLimit(`stats-dsp:${getClientKey(request)}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const { event } = parsed.body;
  if (!isDspEvent(event)) return NextResponse.json({ error: "unknown event" }, { status: 400 });
  try {
    await recordDspEvent(event);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/dsp] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  const rl = rateLimit(`stats-dsp-get:${getClientKey(request)}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  const asked = Number(request.nextUrl.searchParams.get("days"));
  const days = DAYS.has(asked) ? asked : 7;
  try {
    const events = await dspTotals(days);
    return NextResponse.json({ days, events }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[stats/dsp] error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
