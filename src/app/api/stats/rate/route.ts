import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { recordRating, removeRating } from "@/services/stats/kv";

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { episodeId, rating } = body as Record<string, unknown>;

  if (typeof episodeId !== "string" || !episodeId || !EPISODE_ID_RE.test(episodeId)) {
    return NextResponse.json(
      { error: "Invalid episodeId" },
      { status: 400 },
    );
  }

  if (episodeId.length > 200) {
    return NextResponse.json(
      { error: "episodeId too long" },
      { status: 400 },
    );
  }

  // rating === null means "remove rating"
  if (rating === null || rating === undefined) {
    try {
      await removeRating(episodeId, ip);
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("[stats/rate] KV error:", err);
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
    console.error("[stats/rate] KV error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
