/**
 * Choosing a look, browser side (docs/looks.md).
 *
 *   - `chooseLook()` is what the Display setting and the first-visit offer
 *     call: it writes the `hd_look` cookie, remembers that this browser has
 *     chosen, and reloads. The server renders the next page in the new look
 *     (src/proxy.ts and next.config.ts read the cookie), so there is no flash;
 *     a reload rather than a client navigation, because the router cache
 *     holds the old look's pages.
 *   - `shouldOfferNight()` decides the one-time "Prefer dark? Switch to Night"
 *     offer: only in Win98, only to a browser that has never chosen a look
 *     and never been offered. "Offered" is written before the offer shows, so
 *     a browser that cannot store it never sees it (it would otherwise see it
 *     on every page load).
 *
 * Every storage access goes through safe-storage: blocked storage is normal
 * (Safari with cookies blocked, private windows) and must never throw here.
 */

import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";
import { isLook, LOOK_COOKIE, lookCookie, type Look } from "./look";

/** localStorage: the look this browser last chose, set by `chooseLook()`. */
export const LOOK_CHOSEN_KEY = "hd-look-chosen";
/** localStorage: the first-visit offer has been shown (and so is never shown again). */
export const LOOK_OFFER_KEY = "hd-look-offer";

/** The look this page was rendered in (`<html data-look>`), or null when it cannot say. */
export function pageLook(): Look | null {
  if (typeof document === "undefined") return null;
  const v = document.documentElement.dataset.look;
  return isLook(v) ? v : null;
}

/** Whether `document.cookie` carries a look choice at all (any value). */
export function hasLookCookie(cookie: string): boolean {
  return new RegExp(`(?:^|;\\s*)${LOOK_COOKIE}=`).test(cookie);
}

export interface ChooseDeps {
  setCookie: (assignment: string) => void;
  secure: boolean;
  reload: () => void;
}

function browserDeps(): ChooseDeps {
  return {
    setCookie: (a) => {
      document.cookie = a;
    },
    secure: location.protocol === "https:",
    reload: () => location.reload(),
  };
}

/**
 * Remember `look` on this device and reload into it. Also marks the offer as
 * done: a browser that has chosen is never offered.
 */
export function chooseLook(look: Look, deps: ChooseDeps = browserDeps()): void {
  deps.setCookie(lookCookie(look, deps.secure));
  safeSetItem("local", LOOK_CHOSEN_KEY, look);
  safeSetItem("local", LOOK_OFFER_KEY, "done");
  deps.reload();
}

/**
 * Whether this browser should see the first-visit Night offer: rendered in
 * Win98, no look cookie, never chosen, never offered.
 */
export function shouldOfferNight(look: Look, cookie: string): boolean {
  if (look !== "win98") return false;
  if (hasLookCookie(cookie)) return false;
  if (safeGetItem("local", LOOK_CHOSEN_KEY) !== null) return false;
  return safeGetItem("local", LOOK_OFFER_KEY) === null;
}

/**
 * Record that the offer is being shown. Returns false when it cannot be
 * stored, and then the offer must not show (or it would show on every load).
 */
export function markNightOffered(): boolean {
  return safeSetItem("local", LOOK_OFFER_KEY, "shown");
}

/** The offer was answered "no thanks": never again. */
export function dismissNightOffer(): void {
  safeSetItem("local", LOOK_OFFER_KEY, "dismissed");
}
