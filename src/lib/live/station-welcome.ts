/**
 * The station first, for a new desktop visitor (docs/NEXT.md, round 2, item 1;
 * docs/funnel.md, "The station on a desktop's first Library").
 *
 * 30 days to 2026-11-18: of 1,789 desktop first visits, 21% ever saw Live and
 * 12% tuned in; phones, sent to /live on arrival, 79% and 37%. A desktop
 * arrival lands on the Library and meets the station only as the player's
 * idle strip at the bottom. So a browser that arrived new (the funnel's
 * verdict: an empty library) is shown the show on the air above the list,
 * with one Listen live, for its first week, until it tunes in once or closes
 * the window. A browser that arrived with a library, a phone, and a browser
 * with no verdict yet never see it.
 *
 * "Closed or tuned in" is kept in localStorage `hd-station-welcome`. Where
 * storage cannot be written, closing still hides it for this page load.
 */

import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";

export const STATION_WELCOME_KEY = "hd-station-welcome";
/** Days from the arrival day on which the window is offered. */
export const STATION_WELCOME_DAYS = 7;

export type Arrival = { cohort: string } | { excluded: true } | null;

export interface WelcomeInputs {
  arrival: Arrival;
  /** The app's phone breakpoint (useIsMobile). */
  isMobile: boolean;
  /** `hd-station-welcome` is set: closed, or tuned in once. */
  done: boolean;
  /** Tuned in to the station now (held or playing). */
  tuned: boolean;
  /** A show is loaded in the player: this visitor is already listening. */
  hasEpisode: boolean;
  /** Now, epoch ms. */
  now: number;
}

/** Whether the window shows. Pure: every input is passed in. */
export function stationWelcomeShows(i: WelcomeInputs): boolean {
  if (i.isMobile || i.done || i.tuned || i.hasEpisode) return false;
  if (!i.arrival || "excluded" in i.arrival) return false;
  const start = Date.parse(`${i.arrival.cohort}T00:00:00Z`);
  if (!Number.isFinite(start)) return false;
  return i.now - start < STATION_WELCOME_DAYS * 86_400_000;
}

export function stationWelcomeDone(): boolean {
  return safeGetItem("local", STATION_WELCOME_KEY) !== null;
}

/** Closed, or tuned in: never offered again in this browser. */
export function markStationWelcomeDone(why: "closed" | "tuned"): void {
  safeSetItem("local", STATION_WELCOME_KEY, why);
}
