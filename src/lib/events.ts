import { useEffect, useEffectEvent } from "react";
import type { Episode } from "@/db/schema";
import type { EasterEgg } from "@/components/desktop/EasterEggOverlays";

/**
 * The app's window event bus, typed (HD-019).
 *
 * The transport is unchanged — `window` CustomEvents named `hd:<key>` — so
 * anything outside the bundle that already speaks it (the e2e helpers, a
 * console) keeps working. What changed is that the names and their `detail`
 * types are declared once, here: `emit("play-episode", ep)` is checked against
 * this map, and a listener receives the detail already typed instead of
 * casting `(e as CustomEvent<string>).detail` at each of ~50 call sites.
 *
 * `hd:*` string literals are banned everywhere else in src/ by ESLint
 * (`HD_EVENT_NAME_RULES` in eslint.config.mjs), so this file is the only
 * place a name can be spelled.
 *
 * Every key is emitted with a string-literal first argument and heard through
 * `useHdEvent` / `onHdEvent`, also with a literal. That is not style: it is what
 * lets src/lib/__tests__/event-routes.test.ts find every emit and listener site
 * statically and prove that each key emitted on a route has a listener
 * mounted on that route. Library intents fired from /stats once went nowhere
 * (HD-013) because nothing could check that.
 *
 * Library *intents* (shuffle, sort, search, scroll to the current show) are
 * deliberately NOT here: they are fired from the shell on every route, and
 * the library is only mounted on one. They travel in the URL instead — see
 * src/lib/library/intents.ts.
 */
export interface HdEventMap {
  /** Start an episode. Answered by the desktop layout on every desktop route. */
  "play-episode": Episode;
  /** Radio scan: brief audio snippet of the station just hit, and its end. */
  "scan-preview": Episode;
  "scan-preview-stop": void;
  /** Seeding/reconcile has resolved, either way. Notification. */
  "seed-settled": void;
  /** A text size was put into effect; `useTextScale()` readers re-measure. Notification. */
  "text-scale": void;
  /** archive.org reachability, from the player's error path. Notification. */
  "archive-status": { up: boolean };
  /** Mirror a non-error toast into the status bar. Notification. */
  "status-message": string;
  "easter-egg": Exclude<EasterEgg, null>;
  "admin-prompt": void;
  "toggle-shortcuts": void;
  "toggle-ultra-mini": void;
  /** Library filters, fired from rows and the detail panel on /library. */
  "filter-tag": string;
  "filter-category": string;
  /** `null` clears the series filter. */
  "filter-series": string | null;
  "show-guest": string;
}

export type HdEventKey = keyof HdEventMap;

/**
 * Keys that announce something that happened rather than ask for something to
 * be done. Nobody being there to hear one is not a bug — the library's seed
 * listener is simply not mounted on /stats, and `seed-settled` still has to be
 * said. Every other key is an instruction, and an instruction with no listener
 * on the route it was issued from is HD-013. event-routes.test.ts holds the
 * distinction.
 */
export const HD_NOTIFICATIONS: readonly HdEventKey[] = [
  "seed-settled",
  "text-scale",
  "archive-status",
  "status-message",
];

/**
 * The service worker's "you are looking at the offline shell" message
 * (public/sw.js posts it). Not a window event, but an `hd:` name all the same,
 * and this file is where those are spelled.
 */
export const SW_OFFLINE_FALLBACK = "hd:offline-fallback";

/**
 * The transport name for a key. Exported for the e2e specs, which run in a
 * browser outside the bundle and must listen (or dispatch) by name — they
 * import this rather than spell `hd:*` themselves, so the name has one home.
 */
export function hdEventName(type: HdEventKey): string {
  return `hd:${type}`;
}

type DetailArgs<K extends HdEventKey> = HdEventMap[K] extends void ? [] : [detail: HdEventMap[K]];

/** Fire `hd:<type>` on window. The detail is required exactly when the map says so. */
export function emit<K extends HdEventKey>(type: K, ...detail: DetailArgs<K>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    detail.length > 0 ? new CustomEvent(hdEventName(type), { detail: detail[0] }) : new CustomEvent(hdEventName(type)),
  );
}

/**
 * Subscribe outside React. Returns the unsubscribe. Prefer `useHdEvent` in a
 * component — this exists for modules that are not one.
 */
export function onHdEvent<K extends HdEventKey>(
  type: K,
  handler: (detail: HdEventMap[K]) => void,
): () => void {
  const name = hdEventName(type);
  const listener = (e: Event) => handler((e as CustomEvent<HdEventMap[K]>).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

/**
 * Subscribe for the component's lifetime. The subscription is made once per
 * key; the handler is read through an effect event, so it always sees the
 * latest props and state without re-subscribing on every render — the
 * hand-written versions each listed their own dependency array, and one
 * missing entry meant a handler acting on a stale list.
 */
export function useHdEvent<K extends HdEventKey>(
  type: K,
  handler: (detail: HdEventMap[K]) => void,
): void {
  const onEvent = useEffectEvent(handler);
  useEffect(() => onHdEvent(type, (detail) => onEvent(detail)), [type]);
}
