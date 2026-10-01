import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/utils/rate-limit";
import { getNowPlaying } from "@/services/stats/store";
import { catalog } from "@/services/stats/catalog";

/**
 * What the community is doing right now.
 *
 * Response shape:
 *   { online, listening, live,
 *     onAir:  [{ episodeId, listeners, title }],
 *     recent: [{ episodeId, at, title }] }
 *
 * `title` is the catalog's (null for an id the catalog lacks). A browser
 * seeded before a catalog import has no row for the new shows, and On Air
 * printed their ids instead (2026-10-01, src/lib/library/display-title.ts).
 *
 * `live` is the clients, of `online`, tuned in to the live station (a
 * heartbeat with `live: true` inside the window — `getPresence()`).
 *
 * A superset of /api/stats/active, which is kept for the shell's heartbeat
 * loop — that runs on every route and has no use for the episode lists.
 *
 * Never cached: a stale "on air" list is worse than none, since the whole
 * point is that it moves. The underlying queries are two indexed reads.
 *
 * Aggregate only. `onAir` rows are episode ids with counts, and `recent` holds
 * no session id at all, so nothing here can be tied back to a visitor.
 */
export async function GET(request: NextRequest) {
  const ip = getClientKey(request);
  const rl = rateLimit(`stats-now:${ip}`, {
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    const [now, titles] = await Promise.all([getNowPlaying(), catalog()]);
    const title = (id: string) => titles.get(id)?.title ?? null;
    const body = {
      ...now,
      onAir: now.onAir.map((e) => ({ ...e, title: title(e.episodeId) })),
      recent: now.recent.map((r) => ({ ...r, title: title(r.episodeId) })),
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[stats/now] store error:", err);
    return NextResponse.json(
      { error: "Stats service unavailable" },
      { status: 503 },
    );
  }
}
