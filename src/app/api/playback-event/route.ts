import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { recordPlaybackFailure } from "@/services/stats/store";
import { isKnownEpisodeId } from "@/services/stats/allowlist";

/**
 * A show failed to start.
 *
 * Exists because a listener told us "sometimes when I go to play a show it
 * doesn't start… it is a bit consistent for me" and we had no way to find out
 * which shows. Every client-side playback failure previously terminated at a
 * console.error in a browser we would never see.
 *
 * The IP is read only to rate-limit, exactly as /api/stats/play does, and is
 * never written. No session id is accepted or stored — unlike a play, there is
 * no reason to correlate failures within a sitting.
 */

const KINDS = new Set([
  "timeout",
  "stall",
  "play-rejected",
  "network-error",
  "decode-error",
  // The transfer succeeded and the file holds no broadcast. Never retried, so
  // these rows always carry retried=false — a nonzero count here means a bad
  // rip in the catalog, not a flaky connection.
  "empty-media",
  // Advisory, not a failure: `loadedmetadata` reported a duration under the
  // five-second floor and playback was allowed to continue anyway, because for
  // a VBR rip with no Xing header that number is an extrapolation. Carries the
  // reported duration in `detail`. Excluded from the failures ranking — it
  // exists to answer, later and from real traffic, whether the floor is safe to
  // make authoritative.
  "empty-media-suspected",
]);

const UA_CLASSES = new Set([
  "ios-safari",
  "ios-pwa",
  "android-chrome",
  "desktop-safari",
  "desktop-firefox",
  "desktop-chromium",
  "other",
]);

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  // Deliberately lower than stats-play's 60: a client that is failing this
  // often has a problem no amount of reporting will diagnose, and one stuck
  // retry loop should not be able to fill the table.
  const rl = rateLimit(`playback-event:${ip}`, {
    maxRequests: 20,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { episodeId, kind, retried, recovered, elapsedMs, uaClass, detail } =
    body as Record<string, unknown>;

  if (typeof episodeId !== "string" || !episodeId) {
    return NextResponse.json(
      { error: "episodeId is required" },
      { status: 400 },
    );
  }
  if (typeof kind !== "string" || !KINDS.has(kind)) {
    return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
  }

  // Same allowlist gate as /api/stats/play: the table only ever holds ids from
  // the seed catalog, so it cannot be used as arbitrary storage.
  if (!isKnownEpisodeId(episodeId)) {
    return NextResponse.json({ error: "Unknown episodeId" }, { status: 400 });
  }

  const cls =
    typeof uaClass === "string" && UA_CLASSES.has(uaClass) ? uaClass : "other";
  // Clamped rather than rejected — a nonsense elapsed time is not worth losing
  // the rest of the row over.
  const elapsed =
    typeof elapsedMs === "number" && Number.isFinite(elapsedMs)
      ? Math.min(Math.max(Math.round(elapsedMs), 0), 600_000)
      : 0;

  // Truncated rather than rejected, same reasoning as elapsedMs. Bounded so the
  // column cannot be used as arbitrary storage — the allowlist gate above stops
  // that for episodeId, and this is the only other free-text field on the row.
  const det =
    typeof detail === "string" && detail.trim() !== ""
      ? detail.slice(0, 200)
      : null;

  try {
    await recordPlaybackFailure({
      episodeId,
      kind,
      retried: retried === true,
      recovered: recovered === true,
      elapsedMs: elapsed,
      uaClass: cls,
      detail: det,
    });
  } catch (err) {
    // No DATABASE_URL, or Postgres is down. Losing a failure report is not
    // worth surfacing to a user who is already having a bad time.
    console.warn(
      "[playback-event] not recorded:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
