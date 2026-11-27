/**
 * /stats's three tabs (UI plan push 6, batch 1; docs/UI-PLAN.md).
 *
 * Station is everyone's station and needs nothing from IndexedDB; You is this
 * browser's listening; Archive is the catalog. Station is the default and has
 * no parameter, so `/stats` stays the canonical page; the others deep-link as
 * `/stats?tab=you` and `/stats?tab=archive`.
 */

export const STATS_TABS = [
  { key: "station", label: "Station" },
  { key: "you", label: "You" },
  { key: "archive", label: "Archive" },
] as const;

export type StatsTab = (typeof STATS_TABS)[number]["key"];

export const DEFAULT_STATS_TAB: StatsTab = "station";

const KEYS = new Set<string>(STATS_TABS.map((t) => t.key));

/** The tab a query string asks for; anything unknown is the default. */
export function parseStatsTab(search: string): StatsTab {
  const asked = new URLSearchParams(search).get("tab");
  return asked && KEYS.has(asked) ? (asked as StatsTab) : DEFAULT_STATS_TAB;
}

/** The URL of a tab: `/stats` for the default, `/stats?tab=<key>` otherwise. */
export function statsTabHref(tab: StatsTab): string {
  return tab === DEFAULT_STATS_TAB ? "/stats" : `/stats?tab=${tab}`;
}
