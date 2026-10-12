/**
 * Usage tracking, browser side (docs/usage-tracking.md): a view per tab
 * entered, the session's arrival class once, and the tab on the minute
 * heartbeat. Aggregate counters on the server; nothing here is an id.
 *
 * A browser marked not-counted (./not-counted.ts, set by headless checkers
 * such as scripts/csp-check.mjs) sends none of it. The funnel honours the
 * same mark.
 */

import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";
import { classifyArrival } from "@/lib/usage/arrival";
import { routeOf, type ArrivalSource, type UsageDevice, type UsageRoute } from "@/lib/usage/vocab";
import { currentDevice } from "./funnel-client";
import { notCounted } from "./not-counted";
import { pageLook } from "@/lib/look/choice";
import type { Look } from "@/lib/look/look";

/** sessionStorage: this browser session's arrival has been reported. */
export const ARRIVAL_KEY = "hd-arrival";

export interface Arrival {
  source: ArrivalSource;
  landing: UsageRoute;
  /** The look the session landed in (docs/looks.md); absent when the page cannot say. */
  look?: Look;
}

export interface ViewPayload {
  route: UsageRoute;
  device: UsageDevice;
  arrival?: Arrival;
}

/**
 * The session's arrival, the first time it is asked for in this browser
 * session, else null. "Once" is written before anything is sent; a session
 * that cannot remember it reports none, rather than one per page load.
 */
export function takeArrival(
  landingPath: string,
  referrer = typeof document !== "undefined" ? document.referrer : "",
  search = typeof location !== "undefined" ? location.search : "",
  ownHost = typeof location !== "undefined" ? location.host : "",
): Arrival | null {
  if (safeGetItem("session", ARRIVAL_KEY)) return null;
  if (!safeSetItem("session", ARRIVAL_KEY, "1")) return null;
  const look = pageLook();
  return { source: classifyArrival(referrer, search, ownHost), landing: routeOf(landingPath), ...(look ? { look } : {}) };
}

export function viewPayload(pathname: string, arrival: Arrival | null, device: UsageDevice = currentDevice()): ViewPayload {
  return { route: routeOf(pathname), device, ...(arrival ? { arrival } : {}) };
}

/** One tab entered. Fire-and-forget; never throws. */
export function reportView(payload: ViewPayload): void {
  if (notCounted()) return;
  void fetch("/api/stats/view", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

export interface HeartbeatUsage {
  route: UsageRoute;
  device: UsageDevice;
  visible: boolean;
}

/**
 * What the minute heartbeat carries for time per tab: the tab, the device,
 * and whether the page is on screen (the server adds a minute only then).
 * Null for a not-counted browser.
 */
export function heartbeatUsage(
  pathname = typeof location !== "undefined" ? location.pathname : "/",
  visible = typeof document !== "undefined" && document.visibilityState === "visible",
): HeartbeatUsage | null {
  if (notCounted()) return null;
  return { route: routeOf(pathname), device: currentDevice(), visible };
}
