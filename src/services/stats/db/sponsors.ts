/**
 * Station sponsors: impressions and App Store clicks per app
 * (docs/station-breaks.md). Daily counters in `sponsor_daily`, nothing else.
 */

import { pool } from "./pool";
import { SPONSOR_IDS, type SponsorId } from "@/lib/support/sponsors";

export const SPONSOR_SURFACES = ["air", "chat", "stats"] as const;
export type SponsorSurface = (typeof SPONSOR_SURFACES)[number];
export const SPONSOR_EVENTS = ["heard", "seen", "click", "mute"] as const;
export type SponsorEvent = (typeof SPONSOR_EVENTS)[number];

/** Which events a surface can have: a spot is heard, a card or panel seen. */
export const SURFACE_EVENTS: Record<SponsorSurface, readonly SponsorEvent[]> = {
  air: ["heard"],
  chat: ["seen", "click", "mute"],
  stats: ["seen", "click"],
};

export function isSponsorSurface(s: unknown): s is SponsorSurface {
  return typeof s === "string" && (SPONSOR_SURFACES as readonly string[]).includes(s);
}

export function isSponsorEvent(s: unknown): s is SponsorEvent {
  return typeof s === "string" && (SPONSOR_EVENTS as readonly string[]).includes(s);
}

export async function recordSponsorEvent(app: SponsorId, surface: SponsorSurface, event: SponsorEvent): Promise<void> {
  await pool().query(
    `INSERT INTO sponsor_daily (day, app, surface, event, n) VALUES ((now() AT TIME ZONE 'UTC')::date, $1, $2, $3, 1)
     ON CONFLICT (day, app, surface, event) DO UPDATE SET n = sponsor_daily.n + 1`,
    [app, surface, event],
  );
}

export interface SponsorTotals {
  app: SponsorId;
  /** Spots played to a tuned-in listener. */
  heard: number;
  /** Chat cards drawn on a screen. */
  seenChat: number;
  /** /stats panels drawn on a screen. */
  seenStats: number;
  clicksChat: number;
  clicksStats: number;
  /** "Mute breaks" pressed on a card showing this app. */
  mutes: number;
}

/** The last `days` UTC days, today included, one row per app (zeros included). */
export async function sponsorTotals(days: number): Promise<SponsorTotals[]> {
  const { rows } = await pool().query<{ app: SponsorId; surface: SponsorSurface; event: SponsorEvent; n: string }>(
    `SELECT app, surface, event, sum(n)::bigint AS n FROM sponsor_daily
      WHERE day > (now() AT TIME ZONE 'UTC')::date - $1::int
      GROUP BY app, surface, event`,
    [days],
  );
  return SPONSOR_IDS.map((app) => {
    const n = (surface: SponsorSurface, event: SponsorEvent) =>
      Number(rows.find((r) => r.app === app && r.surface === surface && r.event === event)?.n ?? 0);
    return {
      app,
      heard: n("air", "heard"),
      seenChat: n("chat", "seen"),
      seenStats: n("stats", "seen"),
      clicksChat: n("chat", "click"),
      clicksStats: n("stats", "click"),
      mutes: n("chat", "mute"),
    };
  });
}
