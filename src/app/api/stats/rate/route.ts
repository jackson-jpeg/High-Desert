import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { recordRating, removeRating } from "@/services/stats/store";
import { isKnownEpisodeId } from "@/services/stats/allowlist";
import { readJsonObject } from "@/lib/utils/json-body";

const EPISODE_ID_RE = /^[a-zA-Z0-9._-]+$/;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimit(`stats-rate:${ip}`, {
    maxRequests: 30,
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

  const { episodeId, rating } = body;

  if (typeof episodeId !== "string" || !episodeId || !EPISODE_ID_RE.test(episodeId)) {
    return NextResponse.json(
      { error: "Invalid episodeId" },
      { status: 400 },
    );
  }

  if (!isKnownEpisodeId(episodeId)) {
    return NextResponse.json(
      { error: "Unknown episodeId" },
      { status: 400 },
    );
  }

  // rating === null means "remove rating"
  if (rating === null || rating === undefined) {
    try {
      await removeRating(episodeId, ip);
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("[stats/rate] store error:", err);
      return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
    }
  }

  if (typeof rating !== "number" || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return NextResponse.json(
      { error: "rating must be an integer 1-5" },
      { status: 400 },
    );
  }

  try {
    await recordRating(episodeId, rating, ip);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/rate] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
