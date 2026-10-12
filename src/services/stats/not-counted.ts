import { safeGetItem } from "@/lib/utils/safe-storage";

/**
 * The mark a headless checker sets so its pages count as nobody
 * (docs/usage-tracking.md): `localStorage["hd-not-counted"] = "1"`, written by
 * scripts/csp-check.mjs before any page script runs. While it is set the
 * browser sends no view, no arrival, no minute and no funnel step. Presence
 * and plays are not affected; the e2e fixture and presence-check answer those
 * in the page instead.
 */
export const NOT_COUNTED_KEY = "hd-not-counted";

export function notCounted(): boolean {
  return safeGetItem("local", NOT_COUNTED_KEY) === "1";
}
