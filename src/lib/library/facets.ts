/**
 * Everything the library derives from the whole catalogue, in one pass.
 *
 * This was ten separate `useMemo`s in `library/page.tsx` (HD-018), each
 * walking all 1,312 episodes on every live-query update — and a rating or a
 * play count changing is a live-query update. The output is exactly what those
 * memos produced, including tie order: every "top N" sort is stable and runs
 * over Map insertion order, which is first-occurrence order in the input, so
 * the single pass inserts keys in the same order the separate passes did.
 * `facets.test.ts` holds that against the real seed catalogue.
 */

import type { Episode } from "@/db/schema";
import type { ShowFilter } from "@/lib/library/filter-episodes";

export interface MoodFilter {
  label: string;
  kind: "notable" | "favorite" | "category";
  category?: string;
}

export interface LibraryFacets {
  /** Episodes per show type, plus `all`. Show types with no episodes are absent. */
  showCounts: Map<ShowFilter, number>;
  /** Episodes per AI category, in first-seen order. */
  categoryCounts: Map<string, number>;
  /** Episodes per AI series, in first-seen order. */
  seriesCounts: Map<string, number>;
  /** Quick-filter chips: notable, favourites, then up to 8 categories. */
  moodFilters: MoodFilter[];
  /** Top 30 guests by episode count. */
  topGuests: [string, number][];
  /** Top 20 topics by episode count. */
  topTopics: [string, number][];
  /** Search-box suggestions, each sorted. Years are newest first. */
  searchGuests: string[];
  searchCategories: string[];
  searchSeries: string[];
  searchYears: string[];
}

// Friendly labels for long category names
const SHORT_LABELS: Record<string, string> = {
  "UFOs & Aliens": "UFOs",
  "Science & Space": "Space & Science",
  "Time Travel & Physics": "Time Travel",
  "Remote Viewing & Psychic": "Psychic",
  "Prophecy & Predictions": "Prophecy",
  "Health & Medicine": "Health",
  "Earth Changes": "Earth Changes",
};

function bump<K>(map: Map<K, number>, key: K) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function computeFacets(episodes: Episode[] | undefined): LibraryFacets {
  const showCounts = new Map<ShowFilter, number>();
  const categoryCounts = new Map<string, number>();
  const seriesCounts = new Map<string, number>();
  const guestCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const years = new Set<string>();
  let notableCount = 0;
  let favCount = 0;

  if (!episodes) {
    return {
      showCounts, categoryCounts, seriesCounts, moodFilters: [], topGuests: [], topTopics: [],
      searchGuests: [], searchCategories: [], searchSeries: [], searchYears: [],
    };
  }

  showCounts.set("all", episodes.length);
  for (const ep of episodes) {
    bump(showCounts, (ep.showType ?? "unknown") as ShowFilter);
    if (ep.aiCategory) bump(categoryCounts, ep.aiCategory);
    if (ep.aiSeries) bump(seriesCounts, ep.aiSeries);
    if (ep.guestName) bump(guestCounts, ep.guestName);
    if (ep.topic) bump(topicCounts, ep.topic);
    if (ep.airDate) { const y = ep.airDate.slice(0, 4); if (y.length === 4) years.add(y); }
    if (ep.aiNotable) notableCount++;
    if (ep.favoritedAt) favCount++;
  }

  // Dynamic mood filters — only shows categories that actually exist in the library
  const moodFilters: MoodFilter[] = [];
  if (notableCount > 0) moodFilters.push({ label: "Notable", kind: "notable" });
  if (favCount > 0) moodFilters.push({ label: "Favorites", kind: "favorite" });
  // Top categories by episode count (only those with 3+ episodes)
  const topCategories = Array.from(categoryCounts.entries())
    .filter(([cat, count]) => count >= 3 && cat !== "Other" && cat !== "Best Of & Replay")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  for (const [cat] of topCategories) {
    moodFilters.push({ label: SHORT_LABELS[cat] ?? cat, kind: "category", category: cat });
  }

  return {
    showCounts,
    categoryCounts,
    seriesCounts,
    moodFilters,
    topGuests: Array.from(guestCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30),
    topTopics: Array.from(topicCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20),
    // The key sets of the count maps are exactly the distinct values the
    // separate suggestion memos collected.
    searchGuests: Array.from(guestCounts.keys()).sort(),
    searchCategories: Array.from(categoryCounts.keys()).sort(),
    searchSeries: Array.from(seriesCounts.keys()).sort(),
    searchYears: Array.from(years).sort().reverse(),
  };
}
