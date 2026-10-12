/**
 * The words usage tracking counts with (docs/usage-tracking.md), shared by the
 * browser and the server so the two can never disagree about what a route, an
 * arrival source or a play surface is. Each list is also a CHECK constraint
 * in scripts/schema.sql; a value added here goes there too.
 *
 * Pure: no browser API, no database.
 */

/** The app's tabs, as counted in `route_daily`. Anything else is `other`. */
export const USAGE_ROUTES = ["welcome", "library", "radio", "stats", "live", "show", "other"] as const;
export type UsageRoute = (typeof USAGE_ROUTES)[number];

/** Narrower than 768 px is a phone: the app's own breakpoint, as in the funnel. */
export const USAGE_DEVICES = ["phone", "desktop"] as const;
export type UsageDevice = (typeof USAGE_DEVICES)[number];

/** Where a browser session came from, coarsely. Never a host, a URL or a referrer. */
export const ARRIVAL_SOURCES = [
  "reddit",
  "google",
  "other-search",
  "ai",
  "social",
  "internal",
  "direct",
  "other",
] as const;
export type ArrivalSource = (typeof ARRIVAL_SOURCES)[number];

/**
 * Where a play was started. `live` is the station, `queue` a queue advance or
 * a pick from the queue, `restore` the remembered show's first play, `palette`
 * the command palette; the rest are the tab the listener was on.
 */
export const PLAY_SURFACES = ["library", "radio", "live", "stats", "show", "palette", "queue", "restore", "other"] as const;
export type PlaySurface = (typeof PLAY_SURFACES)[number];

function oneOf<T extends string>(list: readonly T[]) {
  return (v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
}

export const isUsageRoute = oneOf(USAGE_ROUTES);
export const isUsageDevice = oneOf(USAGE_DEVICES);
export const isArrivalSource = oneOf(ARRIVAL_SOURCES);
export const isPlaySurface = oneOf(PLAY_SURFACES);

/**
 * A pathname's tab. `/show/<slug>` is `show`; the admin tabs (`/scanner`,
 * `/search`), `/look` and anything unknown are `other`.
 */
export function routeOf(pathname: string | null | undefined): UsageRoute {
  if (!pathname || pathname === "/") return "welcome";
  const first = pathname.split("/")[1] ?? "";
  switch (first) {
    case "library":
    case "radio":
    case "stats":
    case "live":
    case "show":
      return first;
    default:
      return "other";
  }
}
