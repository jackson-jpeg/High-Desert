import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { getCommunityCatalog } from "@/services/stats/store";

/**
 * Community plays and ratings for the whole catalog.
 *
 * Response shape: `{ episodes: { [episodeId]: { plays, avg, count } } }` —
 * only episodes with at least one play or rating appear; absent means zero.
 *
 * What the library's "Most played" and "Top rated" sort by, and what their
 * columns show, so the order and the numbers beside it are one source. Cached
 * briefly at the proxy: every visitor asks for the same answer.
 */
export async function GET(request: NextRequest) {
  const ip = getClientKey(request);
  const rl = rateLimit(`stats-community:${ip}`, {
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const episodes = await getCommunityCatalog();
    return NextResponse.json(
      { episodes },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (err) {
    console.error("[stats/community] store error:", err);
    return NextResponse.json(
      { error: "Stats service unavailable" },
      { status: 503 },
    );
  }
}
