import type { Episode, HistoryEntry } from "@/db/schema";
import { computeStreak } from "@/lib/utils/streak";

/**
 * Every number /stats derives from this browser's IndexedDB, in one pure
 * function so each can be recomputed from raw rows in a test
 * (`src/lib/stats/__tests__/library-stats.test.ts`). It was a 130-line
 * `useMemo` inside the page with no test at all (Part 1D, docs/stats-audit.md).
 */

export interface LibraryStats {
  total: number;
  /** Seconds actually heard, from history (src/services/episodes/listen-time.ts). */
  listenedSeconds: number;
  /** Distinct episodes with any listened time. */
  listenedEpisodes: number;
  librarySeconds: number;
  /** [year, count], ascending, dated rows only. */
  years: [string, number][];
  yearDurations: Map<string, number>;
  /** [decade, count], ascending — sums to the dated rows. */
  decades: [string, number][];
  /** Rows with no air date: in the Episodes total, in no year or decade. */
  undated: number;
  topGuests: [string, number][];
  maxGuestCount: number;
  uniqueGuests: number;
  showCounts: Map<string, number>;
  topTags: [string, number][];
  maxTagCount: number;
  uniqueTags: number;
  topCategories: [string, number][];
  maxCategoryCount: number;
  notableCount: number;
  seriesCount: number;
  avgRating: number;
  ratedCount: number;
  favoriteCount: number;
  /** This browser's plays, top five — labelled "My Most Played". */
  myMostPlayed: Episode[];
  streak: number;
  flaggedEpisodes: Episode[];
}

function tally<T>(items: Iterable<T>, key: (t: T) => string | undefined | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

const byCountDesc = (a: [string, number], b: [string, number]) => b[1] - a[1];

export function computeLibraryStats(episodes: Episode[], history: HistoryEntry[] | undefined): LibraryStats {
  const heard = new Map<number, number>();
  for (const h of history ?? []) {
    if ((h.duration ?? 0) > 0) heard.set(h.episodeId, (heard.get(h.episodeId) ?? 0) + h.duration);
  }
  const listenedSeconds = [...heard.values()].reduce((a, b) => a + b, 0);

  const yearCounts = tally(episodes, (e) => e.airDate?.slice(0, 4));
  const yearDurations = new Map<string, number>();
  for (const ep of episodes) {
    const y = ep.airDate?.slice(0, 4);
    if (y) yearDurations.set(y, (yearDurations.get(y) ?? 0) + (ep.duration ?? 0));
  }
  const years = [...yearCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const decadeMap = new Map<string, number>();
  for (const [year, count] of years) {
    const decade = year.slice(0, 3) + "0s";
    decadeMap.set(decade, (decadeMap.get(decade) ?? 0) + count);
  }
  const undated = episodes.length - years.reduce((n, [, c]) => n + c, 0);

  const guestCounts = tally(episodes, (e) => e.guestName);
  const topGuests = [...guestCounts.entries()].sort(byCountDesc).slice(0, 20);

  const showCounts = tally(episodes, (e) => e.showType ?? "unknown");

  const tagCounts = new Map<string, number>();
  for (const ep of episodes) for (const tag of ep.aiTags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const topTags = [...tagCounts.entries()].sort(byCountDesc).slice(0, 50);

  const topCategories = [...tally(episodes, (e) => e.aiCategory).entries()].sort(byCountDesc);

  const rated = episodes.filter((e) => (e.rating ?? 0) >= 1);

  return {
    total: episodes.length,
    listenedSeconds,
    listenedEpisodes: heard.size,
    librarySeconds: episodes.reduce((sum, e) => sum + (e.duration ?? 0), 0),
    years,
    yearDurations,
    decades: [...decadeMap.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    undated,
    topGuests,
    maxGuestCount: topGuests[0]?.[1] ?? 1,
    uniqueGuests: guestCounts.size,
    showCounts,
    topTags,
    maxTagCount: topTags[0]?.[1] ?? 1,
    uniqueTags: tagCounts.size,
    topCategories,
    maxCategoryCount: topCategories[0]?.[1] ?? 1,
    notableCount: episodes.filter((e) => e.aiNotable).length,
    seriesCount: new Set(episodes.filter((e) => e.aiSeries).map((e) => e.aiSeries!)).size,
    avgRating: rated.length > 0 ? rated.reduce((s, e) => s + (e.rating ?? 0), 0) / rated.length : 0,
    ratedCount: rated.length,
    favoriteCount: episodes.filter((e) => !!e.favoritedAt).length,
    myMostPlayed: episodes
      .filter((e) => (e.playCount ?? 0) > 0)
      .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
      .slice(0, 5),
    streak: computeStreak(history),
    flaggedEpisodes: episodes.filter((e) => !!e.flaggedAt),
  };
}
