import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { recordPlay } from "@/services/stats/store";
import { isKnownEpisodeId } from "@/services/stats/allowlist";

const SESSION_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-play:${ip}`, {
    maxRequests: 60,
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

  const { episodeId, sessionId } = body as Record<string, unknown>;

  if (
    typeof episodeId !== "string" ||
    typeof sessionId !== "string" ||
    !episodeId ||
    !sessionId
  ) {
    return NextResponse.json(
      { error: "episodeId and sessionId are required strings" },
      { status: 400 },
    );
  }

  if (!SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json(
      { error: "Invalid sessionId format" },
      { status: 400 },
    );
  }

  // Only real catalog episodes may be written. This is what stops arbitrary
  // strings from creating rows and inflating the leaderboard.
  if (!isKnownEpisodeId(episodeId)) {
    return NextResponse.json(
      { error: "Unknown episodeId" },
      { status: 400 },
    );
  }

  try {
    await recordPlay(episodeId, sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/play] store error:", err);
    return NextResponse.json(
      { error: "Stats unavailable" },
      { status: 503 },
    );
  }
}
