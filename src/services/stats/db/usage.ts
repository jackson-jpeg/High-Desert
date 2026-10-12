/**
 * Usage: tab views, time per tab, arrivals and where plays start
 * (docs/usage-tracking.md). Daily counters and nothing else: see
 * `route_daily` and `arrival_daily` in scripts/schema.sql. The browser decides
 * the tab, the device and the arrival class; this module only adds one.
 */

import { pool } from "./pool";
import {
  PLAY_SURFACES,
  type ArrivalSource,
  type PlaySurface,
  type UsageDevice,
  type UsageRoute,
} from "@/lib/usage/vocab";

/** Today, in UTC, as the database sees it: every counter's day. */
const TODAY = `(now() AT TIME ZONE 'UTC')::date`;

/** One tab entered; with the session's arrival when it is the session's first. */
export async function recordView(
  route: UsageRoute,
  device: UsageDevice,
  arrival: { source: ArrivalSource; landing: UsageRoute } | null,
): Promise<void> {
  await pool().query(
    `WITH a AS (
       INSERT INTO arrival_daily (day, source, landing, device, n)
       SELECT ${TODAY}, $3, $4, $2, 1 WHERE $3::text IS NOT NULL
       ON CONFLICT (day, source, landing, device) DO UPDATE SET n = arrival_daily.n + 1
     )
     INSERT INTO route_daily (day, route, device, views, minutes) VALUES (${TODAY}, $1, $2, 1, 0)
     ON CONFLICT (day, route, device) DO UPDATE SET views = route_daily.views + 1`,
    [route, device, arrival?.source ?? null, arrival?.landing ?? null],
  );
}

/** One minute on screen in `route`, from the minute heartbeat. */
export async function recordRouteMinute(route: UsageRoute, device: UsageDevice): Promise<void> {
  await pool().query(
    `INSERT INTO route_daily (day, route, device, views, minutes) VALUES (${TODAY}, $1, $2, 0, 1)
     ON CONFLICT (day, route, device) DO UPDATE SET minutes = route_daily.minutes + 1`,
    [route, device],
  );
}

export interface Usage {
  days: number;
  /** Every tab and device with a view or a minute in the window, most viewed first. */
  routes: { route: UsageRoute; device: UsageDevice; views: number; minutes: number }[];
  /** Every arrival class, landing tab and device in the window, largest first. */
  arrivals: { source: ArrivalSource; landing: UsageRoute; device: UsageDevice; n: number }[];
  /** Plays in the window by where they were started; `unknown` is rows with no surface. */
  playsBySurface: Record<PlaySurface | "unknown", number>;
}

/** The last `days` days, today (UTC) included. */
export async function getUsage(days: number): Promise<Usage> {
  const window = `day > ${TODAY} - $1::int`;
  const [routes, arrivals, plays] = await Promise.all([
    pool().query<{ route: UsageRoute; device: UsageDevice; views: string; minutes: string }>(
      `SELECT route, device, sum(views) AS views, sum(minutes) AS minutes
         FROM route_daily WHERE ${window}
        GROUP BY route, device
        ORDER BY sum(views) DESC, route, device`,
      [days],
    ),
    pool().query<{ source: ArrivalSource; landing: UsageRoute; device: UsageDevice; n: string }>(
      `SELECT source, landing, device, sum(n) AS n
         FROM arrival_daily WHERE ${window}
        GROUP BY source, landing, device
        ORDER BY sum(n) DESC, source, landing, device`,
      [days],
    ),
    // The same window as the counters: UTC days, today included.
    pool().query<{ surface: string | null; n: string }>(
      `SELECT surface, count(*) AS n
         FROM play_events
        WHERE played_at >= ((${TODAY} - $1::int + 1)::timestamp AT TIME ZONE 'UTC')
        GROUP BY surface`,
      [days],
    ),
  ]);

  const playsBySurface = Object.fromEntries([...PLAY_SURFACES, "unknown"].map((s) => [s, 0])) as Usage["playsBySurface"];
  for (const r of plays.rows) {
    const key = r.surface && (PLAY_SURFACES as readonly string[]).includes(r.surface) ? (r.surface as PlaySurface) : "unknown";
    playsBySurface[key] += Number(r.n);
  }

  return {
    days,
    routes: routes.rows.map((r) => ({ route: r.route, device: r.device, views: Number(r.views), minutes: Number(r.minutes) })),
    arrivals: arrivals.rows.map((r) => ({ source: r.source, landing: r.landing, device: r.device, n: Number(r.n) })),
    playsBySurface,
  };
}
