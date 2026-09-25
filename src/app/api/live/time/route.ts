import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";

/**
 * This server's clock, for the live station's time sync.
 *
 * Response shape: `{ now: <epoch ms> }`. `no-store`.
 *
 * The client takes several samples, measuring each round trip, and keeps the
 * one with the smallest RTT: its offset is `now − (t0 + t1) / 2`, wrong by at
 * most half that RTT (src/lib/live/time-sync.ts).
 */
export async function GET(request: NextRequest) {
  const ip = getClientKey(request);
  const rl = rateLimit(`live-time:${ip}`, { maxRequests: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  return NextResponse.json({ now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
