import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { buildSchedule, type ScheduleContext } from "@/services/live/days";
import { archiveVerdictPrompt } from "@/services/archive/server-verdict";
import { mirrorManifest } from "@/services/live/manifest";

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
 *            kind: "on-this-date" | "fan-favorite" | "outage-swap",
 *            replaces? }
 *
 * `rest` is today's program after `upNext`; `guide` is all of today's,
 * past slots included. `upNext` may reach into tomorrow.
 *
 * The day is frozen in Postgres the first time it is asked for
 * (src/services/live/days.ts). The outage swap is applied here, per request,
 * from the shared archive.org verdict and the mirror manifest.
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

  const context = async (): Promise<ScheduleContext> => {
    const verdict = await archiveVerdictPrompt();
    const archiveDown = verdict ? !verdict.up : false;
    return { archiveDown, manifest: archiveDown ? await mirrorManifest() : null };
  };

  try {
    const schedule = await buildSchedule(Date.now(), context);
    return NextResponse.json(schedule, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[live/schedule] error:", err);
    return NextResponse.json({ error: "Station unavailable" }, { status: 503 });
  }
}
