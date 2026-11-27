import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { readJsonObject } from "@/lib/utils/json-body";
import { isKnownEpisodeId } from "@/services/stats/allowlist";
import { recordFinish } from "@/services/stats/db/report";

/**
 * A show heard to its end ("Most finished", UI plan push 6, batch 4).
 * POST `{episodeId}` (a catalog key) → `{ok}`; 400 for anything else.
 * Stores the episode and the time only. 20/min per client.
 */
export async function POST(request: NextRequest) {
  const rl = rateLimit(`stats-finish:${getClientKey(request)}`, { maxRequests: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  const parsed = await readJsonObject(request);
  if (parsed.error) return parsed.error;
  const { episodeId } = parsed.body;
  if (typeof episodeId !== "string" || !isKnownEpisodeId(episodeId)) {
    return NextResponse.json({ error: "unknown episode" }, { status: 400 });
  }
  try {
    await recordFinish(episodeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[stats/finish] store error:", err);
    return NextResponse.json({ error: "Stats unavailable" }, { status: 503 });
  }
}
