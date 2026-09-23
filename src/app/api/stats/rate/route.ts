import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { recordRating, removeRating } from "@/services/stats/store";
import { isKnownEpisodeId } from "@/services/stats/allowlist";
import { readJsonObject } from "@/lib/utils/json-body";
import { voterId } from "@/lib/utils/client-key";

const EPISODE_ID_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Submit or clear a rating. Body `{ episodeId, rating }` (1–5, or null to
 * remove). Returns `{ ok: true }`.
 *
 * One vote per client per episode, where "client" is the IPv4 address or the
 * IPv6 /64, and what is stored for it is `voterId()` — an HMAC under
 * RATING_VOTER_SECRET — never the address (HD-008). `rating_votes` is kept
 * forever beside episode ids; a raw IP there is a listening history.
 *
 * Without the secret the route refuses with 503 rather than falling back to
 * anything weaker: a plaintext fallback is the bug this replaced, and an
 * unkeyed hash of an IPv4 address is reversible by enumerating 2^32 of them.
 */
export async function POST(request: NextRequest) {
  const ip = getClientKey(request);
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

  // After input validation, so a malformed request is still a 400 whether or
  // not the server is configured; before any write, so nothing is stored.
  const secret = process.env.RATING_VOTER_SECRET;
  if (!secret) {
    console.error("[stats/rate] RATING_VOTER_SECRET is not set — refusing to record votes");
    return NextResponse.json({ error: "Ratings unavailable" }, { status: 503 });
  }
  const voter = voterId(ip, secret);

  // rating === null means "remove rating"
  if (rating === null || rating === undefined) {
    try {
      await removeRating(episodeId, voter);
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
    await recordRating(episodeId, rating, voter);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/rate] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
