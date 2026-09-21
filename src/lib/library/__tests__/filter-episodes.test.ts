import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Episode } from "@/db/schema";
import {
  filterEpisodes,
  sortEpisodes,
  selectLibraryEpisodes,
  matchComparison,
  type LibraryCriteria,
  type SortMode,
} from "@/lib/library/filter-episodes";

/**
 * The library list pipeline (HD-018). These drive the real exported function
 * with hand-built rows and assert on which ids come out, in what order — never
 * on a copy of the predicate.
 */

let nextId = 1;
function ep(fields: Partial<Episode>): Episode {
  const id = fields.id ?? nextId++;
  return {
    fileHash: `archive:coll:${id}.mp3`,
    fileName: `${id}.mp3`,
    ...fields,
    id,
  } as Episode;
}

const NONE: LibraryCriteria = {
  search: "",
  showFilter: "all",
  favoritesOnly: false,
  guestFilter: null,
  categoryFilter: null,
  seriesFilter: null,
};

const ids = (list: Episode[]) => list.map((e) => e.id);

// airDate descending, as Dexie hands it to the page.
const LIB: Episode[] = [
  ep({ id: 1, airDate: "1999-05-01", title: "Area 51 Caller", showType: "coast", guestName: "Richard Hoagland", aiCategory: "UFOs & Aliens", aiTags: ["Mars", "NASA"], duration: 3 * 3600, favoritedAt: 100, rating: 5, playCount: 3, lastPlayedAt: 50, playbackPosition: 5400, aiSummary: "s", topic: "Face on Mars" }),
  ep({ id: 2, airDate: "1998-10-31", title: "Ghost to Ghost", showType: "special", guestName: "Various", aiCategory: "Paranormal", aiTags: ["ghosts"], duration: 2 * 3600, rating: 3, playCount: 1, lastPlayedAt: 90, aiNotable: true }),
  ep({ id: 3, airDate: "1997-03-13", title: "Mel's Hole Part 1", showType: "coast", guestName: "Mel Waters", aiCategory: "Paranormal", aiSeries: "Mel's Hole", aiSeriesPart: 1, duration: 3600, description: "A bottomless pit in Washington" }),
  ep({ id: 4, airDate: "1996-02-24", title: "Mel's Hole Part 2", showType: "coast", guestName: "Mel Waters", aiCategory: "Paranormal", aiSeries: "Mel's Hole", aiSeriesPart: 2, duration: 3600 }),
  ep({ id: 5, airDate: "1995-01-01", title: "Dreamland Hour", showType: "dreamland", guestName: "Linda Moulton Howe", aiCategory: "Earth Changes", duration: 10 * 60 }),
  ep({ id: 6, airDate: "1994-06-06", fileName: "unknown-show.mp3" }),
];

describe("filterEpisodes — empty criteria", () => {
  it("is the identity: same array, same order", () => {
    expect(filterEpisodes(LIB, NONE)).toBe(LIB);
    expect(filterEpisodes(LIB, { ...NONE, search: "   " })).toBe(LIB);
  });

  it("returns [] for an undefined library through selectLibraryEpisodes", () => {
    expect(selectLibraryEpisodes(undefined, { ...NONE, sortMode: "date" })).toEqual([]);
  });
});

describe("filterEpisodes — sidebar and tab criteria", () => {
  it("showFilter matches showType, and unset showType counts as unknown", () => {
    expect(ids(filterEpisodes(LIB, { ...NONE, showFilter: "coast" }))).toEqual([1, 3, 4]);
    expect(ids(filterEpisodes(LIB, { ...NONE, showFilter: "unknown" }))).toEqual([6]);
  });

  it("favoritesOnly keeps favorited rows", () => {
    expect(ids(filterEpisodes(LIB, { ...NONE, favoritesOnly: true }))).toEqual([1]);
  });

  it("guestFilter is an exact match", () => {
    expect(ids(filterEpisodes(LIB, { ...NONE, guestFilter: "Mel Waters" }))).toEqual([3, 4]);
    expect(ids(filterEpisodes(LIB, { ...NONE, guestFilter: "Mel" }))).toEqual([]);
  });

  it("categoryFilter is an exact match", () => {
    expect(ids(filterEpisodes(LIB, { ...NONE, categoryFilter: "Paranormal" }))).toEqual([2, 3, 4]);
  });

  it("seriesFilter is an exact match", () => {
    expect(ids(filterEpisodes(LIB, { ...NONE, seriesFilter: "Mel's Hole" }))).toEqual([3, 4]);
  });

  it("criteria combine as AND", () => {
    expect(ids(filterEpisodes(LIB, { ...NONE, categoryFilter: "Paranormal", showFilter: "coast" }))).toEqual([3, 4]);
    expect(ids(filterEpisodes(LIB, { ...NONE, categoryFilter: "Paranormal", showFilter: "dreamland" }))).toEqual([]);
  });
});

describe("filterEpisodes — search operators", () => {
  const q = (search: string, extra: Partial<LibraryCriteria> = {}) =>
    ids(filterEpisodes(LIB, { ...NONE, ...extra, search }));

  it("guest: is a case-insensitive substring", () => {
    expect(q("guest:HOAG")).toEqual([1]);
  });
  it("year: is an airDate prefix", () => {
    expect(q("year:1997")).toEqual([3]);
  });
  it("tag: substring-matches any AI tag", () => {
    expect(q("tag:nas")).toEqual([1]);
  });
  it("show: matches showType exactly", () => {
    expect(q("show:special")).toEqual([2]);
  });
  it("cat: substring-matches the category", () => {
    expect(q("cat:earth")).toEqual([5]);
  });
  it("series: substring-matches the series", () => {
    expect(q("series:hole")).toEqual([3, 4]);
  });
  it("has: favorite / fav / summary / played / notable / rated / series", () => {
    expect(q("has:favorite")).toEqual([1]);
    expect(q("has:fav")).toEqual([1]);
    expect(q("has:summary")).toEqual([1]);
    expect(q("has:played")).toEqual([1, 2]);
    expect(q("has:notable")).toEqual([2]);
    expect(q("has:rated")).toEqual([1, 2]);
    expect(q("has:series")).toEqual([3, 4]);
  });
  it("has:bookmark reads the bookmarked id set, and matches nothing while it is loading", () => {
    expect(q("has:bookmark", { bookmarkedIds: new Set([2, 5]) })).toEqual([2, 5]);
    expect(q("has:bookmark")).toEqual([]);
  });
  it("several has: operators all apply", () => {
    expect(q("has:played has:notable")).toEqual([2]);
  });
  it("an unknown has: value filters nothing", () => {
    expect(q("has:wings")).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("duration: is in minutes against seconds, and excludes rows with no duration", () => {
    expect(q("duration:>=120")).toEqual([1, 2]);
    expect(q("duration:<60")).toEqual([5]);
    expect(q("duration:60")).toEqual([3, 4]);
  });
  it("rating: compares, and excludes unrated rows", () => {
    expect(q("rating:>=4")).toEqual([1]);
    expect(q("rating:<4")).toEqual([2]);
  });
  it("favorited:true keeps favorited rows; favorited:false is not a filter", () => {
    expect(q("favorited:true")).toEqual([1]);
    expect(q("favorited:false")).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("filterEpisodes — free text", () => {
  const q = (search: string) => ids(filterEpisodes(LIB, { ...NONE, search }));

  it("matches title, case-insensitively", () => {
    expect(q("GHOST TO")).toEqual([2]);
  });
  it("matches fileName", () => {
    expect(q("unknown-show")).toEqual([6]);
  });
  it("matches guest, topic, airDate, description, category, series and tags", () => {
    expect(q("moulton")).toEqual([5]);
    expect(q("face on")).toEqual([1]);
    expect(q("1996-02")).toEqual([4]);
    expect(q("bottomless")).toEqual([3]);
    expect(q("aliens")).toEqual([1]);
    expect(q("mel's hole")).toEqual([3, 4]);
    expect(q("ghosts")).toEqual([2]);
  });
  it("combines with operators", () => {
    expect(q("mel year:1996")).toEqual([4]);
  });
  it("combines with the sidebar criteria", () => {
    expect(ids(filterEpisodes(LIB, { ...NONE, showFilter: "special", search: "mel" }))).toEqual([]);
  });
});

describe("sortEpisodes", () => {
  const sort = (mode: SortMode, list = LIB, series: string | null = null) => ids(sortEpisodes(list, mode, series));

  it("date keeps the input order (Dexie's airDate desc) and returns the input", () => {
    expect(sortEpisodes(LIB, "date", null)).toBe(LIB);
  });
  it("never mutates its input", () => {
    const before = ids(LIB);
    for (const m of ["name", "guest", "recent", "progress", "rated", "played"] as SortMode[]) sortEpisodes(LIB, m, null);
    sortEpisodes(LIB, "date", "Mel's Hole");
    expect(ids(LIB)).toEqual(before);
  });
  it("name sorts by title, falling back to fileName", () => {
    expect(sort("name")).toEqual([1, 5, 2, 3, 4, 6]);
  });
  it("guest sorts by guest name, then airDate ascending", () => {
    // No guest ("") first; the two Mel Waters shows tie and fall back to airDate.
    expect(sort("guest")).toEqual([6, 5, 4, 3, 1, 2]);
  });
  it("recent sorts by lastPlayedAt desc", () => {
    expect(sort("recent").slice(0, 2)).toEqual([2, 1]);
  });
  it("progress keeps only 5%–95% played and sorts by lastPlayedAt", () => {
    // Episode 1: 5400 / 10800 = 50%.
    expect(sort("progress")).toEqual([1]);
  });
  it("rated sorts by rating desc, then airDate desc", () => {
    expect(sort("rated")).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("played sorts by playCount desc", () => {
    expect(sort("played").slice(0, 2)).toEqual([1, 2]);
  });
  it("a series filter overrides the sort mode and orders by part, not airDate", () => {
    // Part 1 (id 3) aired *after* part 2 (id 4), so part order and airDate
    // order disagree here on purpose.
    const series = LIB.filter((e) => e.aiSeries);
    expect(sort("date", series, "Mel's Hole")).toEqual([3, 4]);
    expect(sort("name", [...series].reverse(), "Mel's Hole")).toEqual([3, 4]);
    // ...including "progress", which is not applied under a series filter.
    expect(sort("progress", series, "Mel's Hole")).toEqual([3, 4]);
  });
  it("under a series filter, a missing part sorts last and ties fall back to airDate ascending", () => {
    const s = [
      ep({ id: 201, aiSeries: "X", airDate: "1999-01-01" }),
      ep({ id: 202, aiSeries: "X", aiSeriesPart: 3, airDate: "1990-01-01" }),
      ep({ id: 203, aiSeries: "X", airDate: "1998-01-01" }),
    ];
    expect(sort("date", s, "X")).toEqual([202, 203, 201]);
  });
  it("is stable: equal keys keep their input order", () => {
    const tied = [ep({ id: 101, playCount: 2 }), ep({ id: 102, playCount: 2 }), ep({ id: 103, playCount: 2 }), ep({ id: 104, playCount: 9 })];
    expect(sort("played", tied)).toEqual([104, 101, 102, 103]);
    expect(sort("played", [...tied].reverse())).toEqual([104, 103, 102, 101]);
  });
});

describe("selectLibraryEpisodes", () => {
  it("filters, then sorts", () => {
    const out = selectLibraryEpisodes(LIB, { ...NONE, categoryFilter: "Paranormal", sortMode: "name" });
    expect(ids(out)).toEqual([2, 3, 4]);
  });

  it("over the real catalogue, a show tab narrows and every row matches it", () => {
    const seedPath = path.resolve(__dirname, "../../../../public/seed/library.json");
    const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    const rows: Episode[] = (Array.isArray(raw) ? raw : raw.episodes).map((r: Episode, i: number) => ({ ...r, id: i + 1 }));
    const all = selectLibraryEpisodes(rows, { ...NONE, sortMode: "date" });
    const dreamland = selectLibraryEpisodes(rows, { ...NONE, showFilter: "dreamland", sortMode: "date" });
    expect(all).toHaveLength(rows.length);
    expect(dreamland.length).toBeGreaterThan(0);
    expect(dreamland.length).toBeLessThan(rows.length);
    expect(dreamland.every((e) => e.showType === "dreamland")).toBe(true);
  });
});

describe("matchComparison", () => {
  it("implements every operator", () => {
    expect(matchComparison(5, ">", 4)).toBe(true);
    expect(matchComparison(4, ">", 4)).toBe(false);
    expect(matchComparison(4, ">=", 4)).toBe(true);
    expect(matchComparison(3, "<", 4)).toBe(true);
    expect(matchComparison(4, "<", 4)).toBe(false);
    expect(matchComparison(4, "<=", 4)).toBe(true);
    expect(matchComparison(4, "=", 4)).toBe(true);
    expect(matchComparison(5, "=", 4)).toBe(false);
  });
});
