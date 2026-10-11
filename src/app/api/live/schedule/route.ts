import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { buildSchedule } from "@/services/live/days";
import { scheduleContext } from "@/services/live/context";

/**
 * The live station's program, and what is on it right now.
 *
 * Response shape (times are epoch ms on this server's clock):
 *
 *   { day: "yyyy-mm-dd" (Pacific), tz: "America/Los_Angeles", serverNow,
 *     stationIdSec,
 *     now:    { slot, startedAt, offsetSec, endsAt }  — a show is on
 *           | { stationId: true, endsAt }              — between shows
 *     upNext: [slot, slot], rest: [slot…], guide: [slot…],
 *     outage: boolean }
 *
 *   slot = { fileHash, episodeId, title, airDate, guestName, showType,
 *            duration, sourceUrl, start, end,
 *            kind: "on-this-date" | "fan-favorite" | "outage-swap"
 *                | "verify-swap" | "breaker-swap",
 *            replaces? }
 *
 * `rest` is today's program after `upNext`; `guide` is all of today's,
 * past slots included. `upNext` may reach into tomorrow.
 *
 * The day is frozen in Postgres the first time it is asked for
 * (src/services/live/days.ts), with any file that failed its frame walk
 * swapped out first (`verify-swap`). The outage swap and the breaker's
 * overrides (`breaker-swap`, src/services/live/breaker.ts) are applied here,
 * per request.
 *
 * `no-store`: `now` and `offsetSec` are stale the moment they are cached.
 * Clients must not use `offsetSec` for playback — it is this server's instant,
 * not theirs; they combine `start` with their own synced clock (/api/live/time).
 * 503 without a database, like the stats routes.
 */
export async function GET(request: NextRequest) {
  const ip = getClientKey(request);
  const rl = rateLimit(`live-schedule:${ip}`, { maxRequests: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const schedule = await buildSchedule(Date.now(), scheduleContext);
    return NextResponse.json(schedule, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[live/schedule] error:", err);
    return NextResponse.json({ error: "Station unavailable" }, { status: 503 });
  }
}
