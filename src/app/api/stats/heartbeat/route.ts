import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp, getClientKey } from "@/lib/utils/rate-limit";
import { SESSIONS_PER_CLIENT, recordHeartbeat, recordRouteMinute, recordTuneIn } from "@/services/stats/store";
import { lookup } from "@/lib/geo/geoip";
import { isUsageDevice, isUsageRoute } from "@/lib/usage/vocab";
import { isKnownEpisodeId } from "@/services/stats/allowlist";
import { readJsonObject } from "@/lib/utils/json-body";

const SESSION_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * Marks a session present. Every open tab posts here on an interval, which is
 * what makes the "online" figure mean "people on the site" rather than "people
 * who happened to press play in the last five minutes".
 *
 * Body: `{ sessionId, episodeId?, live?, route?, device?, visible? }`.
 * `route`/`device`/`visible` are time per tab (docs/usage-tracking.md), sent
 * on the minute beat only: `visible: true` with a known route and device adds
 * a minute to `route_daily`. Invalid values are ignored, never refused.
 *
 * `live: true` means this tab is tuned in to the live station (sent only
 * while tuned and playing, or in the station ID between shows); any other beat clears the live mark — see recordHeartbeat.
 * It is what `live` in /api/stats/now counts.
 * `episodeId` is present only while that tab
 * is actually playing, and renews the listening mark — it is what keeps a show
 * on air for its whole runtime rather than for the five minutes after someone
 * pressed play. Optional by design: a tab that is merely open sends the session
 * alone, and the listening mark it does not send is left untouched rather than
 * cleared, so a pause does not yank the show off the air.
 *
 * The request's address is looked up in the self-hosted geo database
 * (src/lib/geo/geoip.ts): the session row keeps the country and region, and a
 * beat that tunes in adds a line to `visitor_tuneins` (docs/visitors.md).
 *
 * Response shape: `{ ok: true }` — nothing else. (This comment used to promise
 * `{ ok, online, listening }`, which the route has never returned; HD-041.)
 * Document changes here; CLAUDE.md records why response shapes in this
 * directory are worth being careful with.
 *
 * A client (IPv4 address or IPv6 /64) holds at most SESSIONS_PER_CLIENT
 * sessions in the online count. Past that a new session is accepted with the
 * same `{ ok: true }` and simply not counted — see the constant in the store
 * for why that beats a 429.
 */
export async function POST(request: NextRequest) {
  const ip = getClientKey(request);
  // One tab beats every 60s. 20/min leaves room for several tabs plus retries
  // while still capping what a single client can write.
  const rl = rateLimit(`stats-heartbeat:${ip}`, {
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

  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const { sessionId, episodeId, live, route, device, visible } = body;

  if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json(
      { error: "Invalid sessionId format" },
      { status: 400 },
    );
  }

  // Same allowlist gate as /api/stats/play — this writes episode_id, so an
  // arbitrary string here would put a show that does not exist on the air.
  // A bad id drops the listening mark rather than failing the heartbeat:
  // presence is the primary job and must not be lost to a stale catalog key.
  const listeningTo =
    typeof episodeId === "string" && isKnownEpisodeId(episodeId)
      ? episodeId
      : null;

  // Where the beat came from (docs/visitors.md): looked up on this server and
  // kept as a country and region only. The address goes no further.
  const geo = lookup(getClientIp(request));
  try {
    const beat = await recordHeartbeat(sessionId, listeningTo, ip, live === true, geo);
    // "Tuning in from": one line per client per half hour, so a flaky
    // connection re-tuning does not fill the feed with one place.
    if (beat?.tunedIn && geo.country && tuneInAllowed(ip)) {
      await recordTuneIn(geo).catch((err) => console.error("[stats/heartbeat] tune-in not stored:", err));
    }
  } catch (err) {
    console.error("[stats/heartbeat] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }

  // Time per tab (docs/usage-tracking.md): a minute on `route`, only from a
  // tab on screen. Optional, and never a reason to fail the beat: a bad or
  // missing value is simply not counted, and so is a store error.
  if (visible === true && isUsageRoute(route) && isUsageDevice(device) && minuteAllowed(ip)) {
    try {
      await recordRouteMinute(route, device);
    } catch (err) {
      console.error("[stats/heartbeat] usage minute not stored:", err);
    }
  }
  return NextResponse.json({ ok: true });
}

const TUNEIN_PER_CLIENT_MS = 30 * 60_000;

function tuneInAllowed(ip: string): boolean {
  return rateLimit(`stats-tunein:${ip}`, { maxRequests: 1, windowMs: TUNEIN_PER_CLIENT_MS }).allowed;
}

/**
 * One client counts at most SESSIONS_PER_CLIENT visible minutes a minute: as
 * many tabs as the presence cap admits, each beating once. The beat itself is
 * not refused past it (its own limit is above), only its minute not counted.
 */
function minuteAllowed(ip: string): boolean {
  return rateLimit(`stats-heartbeat-minute:${ip}`, { maxRequests: SESSIONS_PER_CLIENT, windowMs: 60_000 }).allowed;
}
