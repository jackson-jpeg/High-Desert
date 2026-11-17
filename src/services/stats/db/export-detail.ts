import { pool } from "./pool";
import { getUsage } from "./usage";

/**
 * `mode=detail` of /api/stats/export, for sang3r.com (2026-11-17): who came,
 * from where, on what, and what they did, over the last `days` UTC days
 * (today included). Aggregates only, read from the counters this site already
 * keeps: route_daily, arrival_daily, visitors, funnel_daily, play_events.
 *
 *   topPages       views per tab (route_daily), top 10
 *   referrers      browser sessions by where they came from (arrival_daily:
 *                  a coarse class decided in the browser, never a host), top 10
 *   countries      browsers seen in the window by their latest country
 *                  (ISO alpha-2; "unknown" when the geo database had none), top 10
 *   devices        browsers seen in the window, phone or desktop
 *   keyNumbers     showsPlayed: plays logged (play_events) in the window;
 *                  distinctShows: different shows among them;
 *                  liveTuneInRate: first-visit browsers of the window's cohorts
 *                  that tuned in to the live station / those that visited
 *                  (funnel_daily, each browser once), null without visits;
 *                  returningListeners: browsers seen in the window on two or
 *                  more distinct days in all;
 *                  playsBySurface: plays by where they were started.
 */

export const DETAIL_DAYS = [7, 30, 90] as const;
export type DetailDays = (typeof DETAIL_DAYS)[number];
const TOP = 10;

export interface NameCount {
  name: string;
  count: number;
}

export interface ExportDetail {
  days: number;
  topPages: NameCount[];
  referrers: NameCount[];
  countries: Array<{ code: string; count: number }>;
  devices: NameCount[];
  keyNumbers: {
    showsPlayed: number;
    distinctShows: number;
    liveTuneInRate: number | null;
    returningListeners: number;
    playsBySurface: Record<string, number>;
  };
}

const TODAY = "(now() AT TIME ZONE 'UTC')::date";

function top(map: Map<string, number>): NameCount[] {
  return [...map]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP);
}

export async function getExportDetail(days: DetailDays): Promise<ExportDetail> {
  const seen = `origin = 'browser' AND last_day > ${TODAY} - $1::int`;
  const [usage, countries, devices, returning, funnel, plays] = await Promise.all([
    getUsage(days),
    pool().query<{ code: string | null; n: string }>(
      `SELECT country AS code, count(*) AS n FROM visitors WHERE ${seen} GROUP BY country`,
      [days],
    ),
    pool().query<{ device: string; n: string }>(
      `SELECT device, count(*) AS n FROM visitors WHERE ${seen} GROUP BY device`,
      [days],
    ),
    pool().query<{ n: string }>(
      `SELECT count(*) AS n FROM visitors WHERE ${seen} AND visit_days >= 2`,
      [days],
    ),
    pool().query<{ step: string; n: string }>(
      `SELECT step, sum(n) AS n FROM funnel_daily
        WHERE day > ${TODAY} - $1::int AND NOT again AND step IN ('visit', 'tune')
        GROUP BY step`,
      [days],
    ),
    pool().query<{ plays: string; shows: string }>(
      `SELECT count(*) AS plays, count(DISTINCT episode_id) AS shows
         FROM play_events
        WHERE played_at >= ((${TODAY} - $1::int + 1)::timestamp AT TIME ZONE 'UTC')`,
      [days],
    ),
  ]);

  const pages = new Map<string, number>();
  for (const r of usage.routes) pages.set(r.route, (pages.get(r.route) ?? 0) + r.views);
  const sources = new Map<string, number>();
  for (const a of usage.arrivals) sources.set(a.source, (sources.get(a.source) ?? 0) + a.n);

  const step = (s: string) => Number(funnel.rows.find((r) => r.step === s)?.n ?? 0);
  const visits = step("visit");

  return {
    days,
    topPages: top(pages),
    referrers: top(sources),
    countries: countries.rows
      .map((r) => ({ code: r.code ?? "unknown", count: Number(r.n) }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, TOP),
    devices: top(new Map(devices.rows.map((r) => [r.device, Number(r.n)]))),
    keyNumbers: {
      showsPlayed: Number(plays.rows[0]?.plays ?? 0),
      distinctShows: Number(plays.rows[0]?.shows ?? 0),
      liveTuneInRate: visits > 0 ? Math.min(1, step("tune") / visits) : null,
      returningListeners: Number(returning.rows[0]?.n ?? 0),
      playsBySurface: { ...usage.playsBySurface },
    },
  };
}
