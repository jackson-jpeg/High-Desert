import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Episode, HistoryEntry } from "@/db/schema";
import { computeLibraryStats } from "@/lib/stats/library-stats";

/**
 * Every /stats number derived from local rows, recomputed from those rows here
 * the plain way and compared (Part 1D, docs/stats-audit.md). The catalog is the
 * real seed, so the invariants are checked against what visitors actually get:
 * decades sum to the dated episodes, dated + undated to the Episodes tile, show
 * types and categories to the total.
 */

const seed: Episode[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../public/seed/library.json"), "utf8"),
).map((r: Episode, i: number) => ({ ...r, id: i + 1 }));
const notableJson: unknown[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../data/notable.json"), "utf8"),
);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("the Archive and Broadcast Log, on the real catalog", () => {
  const s = computeLibraryStats(seed, []);

  it("Episodes is the row count", () => {
    expect(s.total).toBe(seed.length);
  });

  it("decade totals sum to the dated episodes, and dated + undated to Episodes", () => {
    const dated = seed.filter((e) => e.airDate).length;
    expect(sum(s.decades.map(([, c]) => c))).toBe(dated);
    expect(sum(s.years.map(([, c]) => c))).toBe(dated);
    expect(dated + s.undated).toBe(s.total);
  });

  it("each year bar is the count of rows aired that year, and its hours their durations", () => {
    for (const [year, count] of s.years) {
      const rows = seed.filter((e) => e.airDate?.startsWith(year));
      expect(count, year).toBe(rows.length);
      expect(s.yearDurations.get(year), year).toBe(sum(rows.map((e) => e.duration ?? 0)));
    }
  });

  it("each decade is its years", () => {
    for (const [decade, count] of s.decades) {
      const years = s.years.filter(([y]) => y.slice(0, 3) + "0s" === decade);
      expect(count, decade).toBe(sum(years.map(([, c]) => c)));
    }
  });

  it("Program Guide: show types sum to Episodes, each matching its rows", () => {
    expect(sum([...s.showCounts.values()])).toBe(s.total);
    for (const [type, n] of s.showCounts) {
      expect(n, type).toBe(seed.filter((e) => (e.showType ?? "unknown") === type).length);
    }
  });

  it("Subject Breakdown: categories sum to the categorised rows, largest first", () => {
    expect(sum(s.topCategories.map(([, c]) => c))).toBe(seed.filter((e) => e.aiCategory).length);
    for (const [cat, n] of s.topCategories) expect(n, cat).toBe(seed.filter((e) => e.aiCategory === cat).length);
    for (let i = 1; i < s.topCategories.length; i++) {
      expect(s.topCategories[i - 1][1]).toBeGreaterThanOrEqual(s.topCategories[i][1]);
    }
  });

  it("Runtime is the sum of durations", () => {
    expect(s.librarySeconds).toBe(sum(seed.map((e) => e.duration ?? 0)));
  });

  it("Notable is the curated list — not 0", () => {
    expect(s.notableCount).toBe(notableJson.length);
    expect(s.notableCount).toBeGreaterThan(0);
  });

  it("Series counts distinct multi-part sets, each of which really has several parts", () => {
    const names = new Set(seed.filter((e) => e.aiSeries).map((e) => e.aiSeries));
    expect(s.seriesCount).toBe(names.size);
    for (const n of names) expect(seed.filter((e) => e.aiSeries === n).length, n).toBeGreaterThan(1);
  });

  it("guests: unique count, and the top 20 are each their row count, descending", () => {
    expect(s.uniqueGuests).toBe(new Set(seed.filter((e) => e.guestName).map((e) => e.guestName)).size);
    expect(s.topGuests.length).toBe(Math.min(20, s.uniqueGuests));
    for (const [g, n] of s.topGuests) expect(n, g).toBe(seed.filter((e) => e.guestName === g).length);
    const floor = s.topGuests[s.topGuests.length - 1][1];
    const counts = new Map<string, number>();
    for (const e of seed) if (e.guestName) counts.set(e.guestName, (counts.get(e.guestName) ?? 0) + 1);
    // Nobody left out of the top 20 has more appearances than the 20th.
    for (const [g, n] of counts) if (!s.topGuests.some(([t]) => t === g)) expect(n, g).toBeLessThanOrEqual(floor);
  });

  it("tags: unique count, and each shown tag's weight is its row count", () => {
    expect(s.uniqueTags).toBe(new Set(seed.flatMap((e) => e.aiTags ?? [])).size);
    for (const [t, n] of s.topTags) expect(n, t).toBe(seed.filter((e) => e.aiTags?.includes(t)).length);
  });
});

describe("Your Listening", () => {
  const eps: Episode[] = [
    { id: 1, title: "A", playCount: 3, rating: 5, favoritedAt: 1, playbackPosition: 0, duration: 10_800 },
    { id: 2, title: "B", playCount: 7, rating: 2, playbackPosition: 9_000, duration: 10_800 },
    { id: 3, title: "C", playCount: 0, playbackPosition: 10_000, duration: 10_800 },
    { id: 4, title: "D", playCount: 1, flaggedAt: 5 },
  ] as Episode[];
  const history: HistoryEntry[] = [
    { id: 1, episodeId: 1, timestamp: 1, duration: 10_800 }, // finished: position is back to 0
    { id: 2, episodeId: 1, timestamp: 2, duration: 600 },
    { id: 3, episodeId: 2, timestamp: 3, duration: 1_200 },
    { id: 4, episodeId: 3, timestamp: 4, duration: 0 }, // seeked to near the end, heard nothing
  ];
  const s = computeLibraryStats(eps, history);

  it("Listened is time heard, from history — not playback positions", () => {
    expect(s.listenedSeconds).toBe(10_800 + 600 + 1_200);
    // The old figure: sum of playbackPosition = 19,000 s, and 2 "episodes".
    expect(s.listenedSeconds).not.toBe(9_000 + 10_000);
    expect(s.listenedEpisodes).toBe(2);
  });

  it("finishing a show does not lower Listened", () => {
    const finished = eps.map((e) => (e.id === 2 ? { ...e, playbackPosition: 0 } : e));
    expect(computeLibraryStats(finished, history).listenedSeconds).toBe(s.listenedSeconds);
  });

  it("My Most Played is ranked by this browser's plays, and those are the numbers it holds", () => {
    expect(s.myMostPlayed.map((e) => e.id)).toEqual([2, 1, 4]);
  });

  it("ratings, favourites, flags", () => {
    expect(s.ratedCount).toBe(2);
    expect(s.avgRating).toBe(3.5);
    expect(s.favoriteCount).toBe(1);
    expect(s.flaggedEpisodes.map((e) => e.id)).toEqual([4]);
  });
});
