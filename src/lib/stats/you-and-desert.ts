import type { Episode, HistoryEntry } from "@/db/schema";
import { communityKey } from "@/lib/utils/community-key";
import { shownGuest } from "@/lib/library/guest";
import type { CommunityIndex } from "@/lib/library/sort-keys";
import { realListens } from "@/lib/stats/listens";

export interface YouAndTheDesert {
  /** Catalog shows heard for a minute or more. */
  heard: number;
  /** Catalog shows in this library. */
  catalog: number;
  /** The guest this browser has heard most, by time heard. */
  yourGuest: { name: string; seconds: number } | null;
  /** The guest everyone has played most, by community plays. */
  stationGuest: { name: string; plays: number } | null;
}

function top<T extends string>(m: Map<T, number>): [T, number] | null {
  let best: [T, number] | null = null;
  for (const [k, v] of m) {
    if (v <= 0) continue;
    if (!best || v > best[1] || (v === best[1] && k.localeCompare(best[0]) < 0)) best = [k, v];
  }
  return best;
}

/**
 * "You and the desert" on /stats's You tab (UI plan push 6, batch 4): how
 * much of the archive this browser has heard, and its top guest beside the
 * station's. Real listens only (the same rule as the tiles); community plays
 * from /api/stats/community. Nothing estimated.
 */
export function youAndTheDesert(
  episodes: readonly Episode[],
  history: readonly HistoryEntry[],
  community: CommunityIndex,
): YouAndTheDesert {
  const catalog = new Map<number, Episode>();
  for (const ep of episodes) if (ep.id != null && communityKey(ep)) catalog.set(ep.id, ep);

  const heardIds = new Set<number>();
  const byGuest = new Map<string, number>();
  for (const r of realListens(history)) {
    const ep = catalog.get(r.episodeId);
    if (!ep) continue;
    heardIds.add(r.episodeId);
    const g = shownGuest(ep);
    if (g) byGuest.set(g, (byGuest.get(g) ?? 0) + (r.duration ?? 0));
  }

  const stationByGuest = new Map<string, number>();
  for (const ep of catalog.values()) {
    const g = shownGuest(ep);
    const key = communityKey(ep);
    const plays = key ? community.get(key)?.plays ?? 0 : 0;
    if (g && plays > 0) stationByGuest.set(g, (stationByGuest.get(g) ?? 0) + plays);
  }

  const you = top(byGuest);
  const station = top(stationByGuest);
  return {
    heard: heardIds.size,
    catalog: catalog.size,
    yourGuest: you ? { name: you[0], seconds: you[1] } : null,
    stationGuest: station ? { name: station[0], plays: station[1] } : null,
  };
}
