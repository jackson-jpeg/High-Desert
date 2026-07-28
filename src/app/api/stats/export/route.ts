import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withEpisodeInfo } from "@/services/stats/catalog";
import {
  getDailyTraffic,
  getEpisodeStats,
  getExportSummary,
  getNowPlaying,
  getPlayEvents,
} from "@/services/stats/store";

/**
 * The permanent analytics record, for sang3r.com.
 *
 * Machine-facing and authenticated — every other route under /api/stats is
 * public and deliberately returns only aggregates, because it is read by
 * browsers. This one returns the event log, so it is gated on a shared secret
 * and never reachable from the site itself.
 *
 * Modes:
 *   summary (default) — headline totals, top episodes, 30 days of daily
 *                       history, and what is on air right now. One request,
 *                       everything a dashboard needs.
 *   events            — a page of the raw play log, oldest first. Page with
 *                       `after` (the last id you saw), not with `since`.
 *   daily             — the permanent daily rollup.
 *   episodes          — per-episode totals with community ratings.
 *
 * Episode ids are resolved to titles from the shipped catalog; see
 * src/services/stats/catalog.ts for why that happens here and not downstream.
 */

/** Hard ceiling on an events page, so one request cannot pull the whole log. */
const MAX_EVENT_LIMIT = 5_000;
const DEFAULT_EVENT_LIMIT = 1_000;
const MAX_EPISODE_LIMIT = 2_000;
const MAX_DAILY_DAYS = 3_650;

function authorized(request: NextRequest): boolean {
  const expected = process.env.STATS_EXPORT_SECRET;
  // Same stance as /api/stats/sample: with no secret configured the route
  // refuses outright rather than serving the log unauthenticated.
  if (!expected) return false;

  const provided =
    request.headers.get("x-service-token") ??
    request.headers.get("x-sample-token") ??
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Clamp a query param to a range, falling back on anything unparseable. */
function intParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  max: number,
  min = 1,
): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function dateParam(params: URLSearchParams, name: string): Date | undefined {
  const raw = params.get(name);
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const mode = params.get("mode") ?? "summary";

  try {
    switch (mode) {
      case "events": {
        const limit = intParam(
          params,
          "limit",
          DEFAULT_EVENT_LIMIT,
          MAX_EVENT_LIMIT,
        );
        const afterRaw = params.get("after");
        const afterId = afterRaw ? Number.parseInt(afterRaw, 10) : undefined;

        const events = await getPlayEvents({
          since: dateParam(params, "since"),
          until: dateParam(params, "until"),
          afterId: Number.isFinite(afterId) ? afterId : undefined,
          limit,
        });

        return NextResponse.json({
          mode,
          events: await withEpisodeInfo(events),
          // The cursor to pass back as `after`. Null when the page came back
          // short, which is the caller's signal that it has caught up.
          nextCursor:
            events.length === limit ? events[events.length - 1].id : null,
          count: events.length,
        });
      }

      case "daily": {
        const days = intParam(params, "days", 90, MAX_DAILY_DAYS);
        return NextResponse.json({ mode, days: await getDailyTraffic(days) });
      }

      case "episodes": {
        const limit = intParam(params, "limit", 100, MAX_EPISODE_LIMIT);
        return NextResponse.json({
          mode,
          episodes: await withEpisodeInfo(await getEpisodeStats(limit)),
        });
      }

      case "summary": {
        const topLimit = intParam(params, "limit", 25, MAX_EPISODE_LIMIT);
        const days = intParam(params, "days", 30, MAX_DAILY_DAYS);

        const [summary, top, daily, now] = await Promise.all([
          getExportSummary(),
          getEpisodeStats(topLimit),
          getDailyTraffic(days),
          getNowPlaying(),
        ]);

        const [topEpisodes, onAir, recent] = await Promise.all([
          withEpisodeInfo(top),
          withEpisodeInfo(now.onAir),
          withEpisodeInfo(now.recent),
        ]);

        return NextResponse.json({
          mode,
          summary,
          topEpisodes,
          daily,
          now: {
            online: now.online,
            listening: now.listening,
            onAir,
            recent,
          },
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown mode: ${mode}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error("[stats/export] store error:", err);
    return NextResponse.json(
      { error: "Stats service unavailable" },
      { status: 503 },
    );
  }
}
