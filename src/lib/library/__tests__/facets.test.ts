import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Episode } from "@/db/schema";
import { computeFacets } from "@/lib/library/facets";

/**
 * computeFacets() replaced ten separate useMemos in library/page.tsx (HD-018).
 *
 * Two kinds of test. The hand-built ones assert values worked out by hand. The
 * equivalence test runs the page's ten memos exactly as they stood before the
 * split (`legacyFacets`, copied from the page at ee57702) against the real seed
 * catalogue and requires identical output — tie order included. (The three
 * identical search-suggestion memos are folded into one `distinct` helper;
 * the logic is theirs.)
 *
 * `legacyFacets` is an oracle of the *old* code, not a re-implementation of
 * the new one: it is frozen, and computeFacets shares no code with it. That is
 * what makes it evidence of "behaviour unchanged" rather than agreement by
 * construction (docs/disconnected-checks.md).
 */

function legacyFacets(allEpisodes: Episode[] | undefined) {
  type ShowFilter = "all" | "coast" | "dreamland" | "special" | "unknown";
  const showCounts = (() => {
    if (!allEpisodes) return new Map<ShowFilter, number>();
    const counts = new Map<ShowFilter, number>();
    counts.set("all", allEpisodes.length);
    for (const ep of allEpisodes) {
      const type = (ep.showType ?? "unknown") as ShowFilter;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return counts;
  })();
  const categoryCounts = (() => {
    if (!allEpisodes) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const ep of allEpisodes) {
      if (ep.aiCategory) {
        counts.set(ep.aiCategory, (counts.get(ep.aiCategory) ?? 0) + 1);
      }
    }
    return counts;
  })();
  const moodFilters = (() => {
    if (!allEpisodes) return [];
    const filters: { label: string; kind: "notable" | "favorite" | "category"; category?: string }[] = [];
    const notableCount = allEpisodes.filter((ep) => !!ep.aiNotable).length;
    if (notableCount > 0) filters.push({ label: "Notable", kind: "notable" });
    const favCount = allEpisodes.filter((ep) => !!ep.favoritedAt).length;
    if (favCount > 0) filters.push({ label: "Favorites", kind: "favorite" });
    const sorted = Array.from(categoryCounts.entries())
      .filter(([cat, count]) => count >= 3 && cat !== "Other" && cat !== "Best Of & Replay")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const SHORT_LABELS: Record<string, string> = {
      "UFOs & Aliens": "UFOs",
      "Science & Space": "Space & Science",
      "Time Travel & Physics": "Time Travel",
      "Remote Viewing & Psychic": "Psychic",
      "Prophecy & Predictions": "Prophecy",
      "Health & Medicine": "Health",
      "Earth Changes": "Earth Changes",
    };
    for (const [cat] of sorted) {
      filters.push({ label: SHORT_LABELS[cat] ?? cat, kind: "category", category: cat });
    }
    return filters;
  })();
  const seriesCounts = (() => {
    if (!allEpisodes) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const ep of allEpisodes) {
      if (ep.aiSeries) {
        counts.set(ep.aiSeries, (counts.get(ep.aiSeries) ?? 0) + 1);
      }
    }
    return counts;
  })();
  const topGuests = (() => {
    if (!allEpisodes) return [];
    const guestCounts = new Map<string, number>();
    for (const ep of allEpisodes) {
      if (ep.guestName) {
        guestCounts.set(ep.guestName, (guestCounts.get(ep.guestName) ?? 0) + 1);
      }
    }
    return Array.from(guestCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);
  })();
  const topTopics = (() => {
    if (!allEpisodes) return [];
    const topicCounts = new Map<string, number>();
    for (const ep of allEpisodes) {
      if (ep.topic) {
        topicCounts.set(ep.topic, (topicCounts.get(ep.topic) ?? 0) + 1);
      }
    }
    return Array.from(topicCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
  })();
  const distinct = (pick: (ep: Episode) => string | undefined) => {
    if (!allEpisodes) return [];
    const set = new Set<string>();
    for (const ep of allEpisodes) { const v = pick(ep); if (v) set.add(v); }
    return Array.from(set).sort();
  };
  const searchYears = (() => {
    if (!allEpisodes) return [];
    const set = new Set<string>();
    for (const ep of allEpisodes) {
      if (ep.airDate) { const y = ep.airDate.slice(0, 4); if (y.length === 4) set.add(y); }
    }
    return Array.from(set).sort().reverse();
  })();
  return {
    showCounts,
    categoryCounts,
    seriesCounts,
    moodFilters,
    topGuests,
    topTopics,
    searchGuests: distinct((e) => e.guestName),
    searchCategories: distinct((e) => e.aiCategory),
    searchSeries: distinct((e) => e.aiSeries),
    searchYears,
  };
}

/** Maps compared with their iteration order, which the sidebar renders in. */
function comparable(f: ReturnType<typeof legacyFacets>) {
  return {
    ...f,
    showCounts: Array.from(f.showCounts.entries()),
    categoryCounts: Array.from(f.categoryCounts.entries()),
    seriesCounts: Array.from(f.seriesCounts.entries()),
  };
}

const seedPath = path.resolve(__dirname, "../../../../public/seed/library.json");
const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
// Dexie hands the page the catalogue in airDate-descending order.
const catalogue: Episode[] = (Array.isArray(raw) ? raw : raw.episodes)
  .map((r: Episode, i: number) => ({ ...r, id: i + 1 }))
  .sort((a: Episode, b: Episode) => (b.airDate ?? "").localeCompare(a.airDate ?? ""));

describe("computeFacets — equivalence with the page's memos", () => {
  it("matches them exactly on the real seed catalogue", () => {
    expect(catalogue.length).toBeGreaterThan(1000);
    expect(comparable(computeFacets(catalogue))).toEqual(comparable(legacyFacets(catalogue)));
  });

  it("matches them with user state layered on (favourites, notables, gaps)", () => {
    // The seed has no favourites or notables, so the first two mood chips never
    // appear on it; nor any missing field. Layer some on, deterministically.
    const layered = catalogue.map((e, i) => ({
      ...e,
      favoritedAt: i % 17 === 0 ? 1000 + i : undefined,
      aiNotable: i % 23 === 0 ? true : undefined,
      showType: i % 41 === 0 ? undefined : e.showType,
      guestName: i % 29 === 0 ? undefined : e.guestName,
      airDate: i % 97 === 0 ? "199" : e.airDate,
    })) as Episode[];
    const got = computeFacets(layered);
    expect(got.moodFilters.slice(0, 2).map((m) => m.kind)).toEqual(["notable", "favorite"]);
    expect(comparable(got)).toEqual(comparable(legacyFacets(layered)));
  });

  it("matches them in a different input order (tie order follows the input)", () => {
    const reversed = [...catalogue].reverse();
    expect(comparable(computeFacets(reversed))).toEqual(comparable(legacyFacets(reversed)));
  });

  it("matches them for an undefined and an empty library", () => {
    expect(comparable(computeFacets(undefined))).toEqual(comparable(legacyFacets(undefined)));
    expect(comparable(computeFacets([]))).toEqual(comparable(legacyFacets([])));
  });
});

describe("computeFacets — hand-computed", () => {
  const e = (f: Partial<Episode>) => ({ fileHash: "h", fileName: "f.mp3", ...f }) as Episode;
  const lib = [
    e({ showType: "coast", aiCategory: "UFOs & Aliens", guestName: "A", topic: "t1", airDate: "1999-01-01", aiSeries: "S" }),
    e({ showType: "coast", aiCategory: "UFOs & Aliens", guestName: "B", topic: "t1", airDate: "1998-01-01", aiSeries: "S" }),
    e({ showType: "dreamland", aiCategory: "UFOs & Aliens", guestName: "B", topic: "t2", airDate: "1998-06-01", favoritedAt: 1 }),
    e({ aiCategory: "Other", guestName: "B", airDate: "97" }),
    e({ aiCategory: "Other" }),
    e({ aiCategory: "Other", aiNotable: true }),
  ];
  const f = computeFacets(lib);

  it("counts show types, with a missing type as unknown and `all` first", () => {
    expect(Array.from(f.showCounts.entries())).toEqual([["all", 6], ["coast", 2], ["dreamland", 1], ["unknown", 3]]);
  });
  it("counts categories and series", () => {
    expect(Array.from(f.categoryCounts.entries())).toEqual([["UFOs & Aliens", 3], ["Other", 3]]);
    expect(Array.from(f.seriesCounts.entries())).toEqual([["S", 2]]);
  });
  it("ranks guests and topics by count", () => {
    expect(f.topGuests).toEqual([["B", 3], ["A", 1]]);
    expect(f.topTopics).toEqual([["t1", 2], ["t2", 1]]);
  });
  it("builds mood chips: notable, favourites, then 3+ categories excluding Other", () => {
    expect(f.moodFilters).toEqual([
      { label: "Notable", kind: "notable" },
      { label: "Favorites", kind: "favorite" },
      { label: "UFOs", kind: "category", category: "UFOs & Aliens" },
    ]);
  });
  it("collects sorted search suggestions, years newest first and only four-digit", () => {
    expect(f.searchGuests).toEqual(["A", "B"]);
    expect(f.searchCategories).toEqual(["Other", "UFOs & Aliens"]);
    expect(f.searchSeries).toEqual(["S"]);
    expect(f.searchYears).toEqual(["1999", "1998"]);
  });
});
