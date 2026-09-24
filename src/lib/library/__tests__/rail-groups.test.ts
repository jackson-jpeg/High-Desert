import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Episode } from "@/db/schema";
import { sortEpisodes, SORT_MODES, type SortMode } from "@/lib/library/filter-episodes";
import {
  deriveRailGroups,
  activeGroupIndex,
  railKind,
  type RailGroup,
} from "@/lib/library/rail-groups";
import type { CommunityIndex, CommunityNumbers } from "@/lib/library/sort-keys";
import { communityKey } from "@/lib/utils/community-key";

/**
 * The rail is a projection of the list (docs/timeline-rail.md). Every case here
 * feeds `deriveRailGroups` the output of the real `sortEpisodes`, never a
 * hand-ordered copy of what a sort "should" produce, and checks the rail
 * against the rows it was given: group `i` starts at row `firstIndex`, and the
 * groups read top to bottom in the order those rows appear.
 */

let nextId = 1;
function ep(fields: Partial<Episode>): Episode {
  const id = fields.id ?? nextId++;
  return { fileHash: `archive:coll:${id}.mp3`, fileName: `${id}.mp3`, archiveIdentifier: "coll", ...fields, id } as Episode;
}

const keys = (g: RailGroup[]) => g.map((x) => x.key);
const firsts = (g: RailGroup[]) => g.map((x) => x.firstIndex);

// Dexie's order: airDate descending.
const DESC: Episode[] = [
  ep({ airDate: "2001-05-02", title: "Coast to Coast AM - Zeta", guestName: "Richard Hoagland", rating: 5, playCount: 12 }),
  ep({ airDate: "2001-01-09", title: "Coast to Coast AM - Area 51", guestName: "Ed Dames", rating: 4, playCount: 6 }),
  ep({ airDate: "1999-10-31", title: "Dreamland - Ghosts", guestName: "Linda Moulton Howe", playCount: 3 }),
  ep({ airDate: "1999-02-01", title: "Dreamland - Crop Circles", guestName: "Élan Vital", rating: 5, playCount: 1 }),
  ep({ airDate: "1997-03-13", title: "Somewhere in Time", guestName: "Mel Waters", rating: 2 }),
  ep({ airDate: "1997-01-01", title: "2008 Predictions", guestName: "'Entity Attack'" }),
];

describe("deriveRailGroups — date order", () => {
  it("newest first: the rail runs newest → oldest, as the list does", () => {
    const rows = sortEpisodes(DESC, "date", null);
    const g = deriveRailGroups(rows, "date");
    expect(keys(g)).toEqual(["2001", "1999", "1997"]);
    expect(firsts(g)).toEqual([0, 2, 4]);
    expect(g.map((x) => x.count)).toEqual([2, 2, 2]);
    expect(g[0].label).toBe("’01");
  });

  it("oldest first: the rail runs oldest → newest, as the list does", () => {
    const rows = sortEpisodes(DESC, "date-asc", null);
    const g = deriveRailGroups(rows, "date-asc");
    expect(keys(g)).toEqual(["1997", "1999", "2001"]);
    expect(firsts(g)).toEqual([0, 2, 4]);
  });

  it("a series filter gets a year rail in the series' own order", () => {
    const series = [
      ep({ airDate: "1996-02-24", aiSeries: "S", aiSeriesPart: 1 }),
      ep({ airDate: "1997-03-13", aiSeries: "S", aiSeriesPart: 2 }),
      ep({ airDate: "2000-02-21", aiSeries: "S", aiSeriesPart: 3 }),
    ];
    const rows = sortEpisodes([...series].reverse(), "name", "S");
    expect(keys(deriveRailGroups(rows, "name", "S"))).toEqual(["1996", "1997", "2000"]);
  });

  it("rows without a date form their own group where they fall", () => {
    const rows = sortEpisodes([ep({}), ...DESC], "date-asc", null);
    const g = deriveRailGroups(rows, "date-asc");
    expect(g[g.length - 1]).toMatchObject({ key: "Unknown", firstIndex: rows.length - 1, count: 1 });
  });
});

describe("deriveRailGroups — non-chronological sorts", () => {
  it("name → title initials, accents folded, digits/symbols under #", () => {
    const rows = sortEpisodes(DESC, "name", null);
    const g = deriveRailGroups(rows, "name");
    expect(keys(g)).toEqual(["#", "C", "D", "S"]);
    expect(firsts(g)).toEqual([0, 1, 3, 5]);
  });

  it("guest → guest initials in guest order", () => {
    const rows = sortEpisodes(DESC, "guest", null);
    const g = deriveRailGroups(rows, "guest");
    // ICU collation puts punctuation first; É folds to E.
    expect(keys(g)).toEqual(["#", "E", "L", "M", "R"]);
    expect(firsts(g)).toEqual([0, 1, 3, 4, 5]);
  });

  it("my-rating → star buckets of this browser's ratings, 5★ first, unrated last", () => {
    const rows = sortEpisodes(DESC, "my-rating", null);
    const g = deriveRailGroups(rows, "my-rating");
    expect(g.map((x) => x.label)).toEqual(["5★", "4★", "2★", "—"]);
    expect(firsts(g)).toEqual([0, 2, 3, 4]);
  });

  it("my-plays → play-count buckets of this browser's plays, most first", () => {
    const rows = sortEpisodes(DESC, "my-plays", null);
    expect(keys(deriveRailGroups(rows, "my-plays"))).toEqual(["10+", "5-9", "2-4", "1", "0"]);
  });

  // DESC's local numbers disagree with these on purpose: a rail bucketing the
  // wrong source draws the wrong groups.
  it("the fixture rows have community keys (else every lookup is zero)", () => {
    expect(DESC.every((e) => communityKey(e))).toBe(true);
  });
  const COMMUNITY: CommunityIndex = new Map<string, CommunityNumbers>([
    [communityKey(DESC[0])!, { plays: 3, avg: 1.5, count: 2 }],
    [communityKey(DESC[1])!, { plays: 132, avg: 4.2, count: 5 }],
    [communityKey(DESC[2])!, { plays: 41, avg: 5, count: 1 }],
    [communityKey(DESC[3])!, { plays: 7, avg: 0, count: 0 }],
    [communityKey(DESC[4])!, { plays: 1, avg: 4.9, count: 3 }],
  ]);

  it("played → community play buckets, from the same numbers the list sorted by", () => {
    const rows = sortEpisodes(DESC, "played", null, COMMUNITY);
    const g = deriveRailGroups(rows, "played", null, 0, COMMUNITY);
    expect(keys(g)).toEqual(["100+", "20-49", "5-9", "2-4", "1", "0"]);
    expect(g.map((x) => x.count)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("rated → community average buckets (floor), unrated last", () => {
    const rows = sortEpisodes(DESC, "rated", null, COMMUNITY);
    const g = deriveRailGroups(rows, "rated", null, 0, COMMUNITY);
    expect(g.map((x) => x.label)).toEqual(["5★", "4★", "1★", "—"]);
    // 4.9 and 4.2 are one run: both are "4.0–4.9".
    expect(g.map((x) => x.count)).toEqual([1, 2, 1, 2]);
  });

  it("recent → recency buckets against the given clock, never-played last", () => {
    const now = 100 * 86_400_000;
    const day = 86_400_000;
    const list = [
      ep({ airDate: "1999-01-01", lastPlayedAt: now - 3 * day }),
      ep({ airDate: "1998-01-01", lastPlayedAt: now - 60 * day }),
      ep({ airDate: "1997-01-01" }),
      ep({ airDate: "1996-01-01", lastPlayedAt: now - 1000 }),
      ep({ airDate: "1995-01-01", lastPlayedAt: now - 10 * day }),
    ];
    const rows = sortEpisodes(list, "recent", null);
    const g = deriveRailGroups(rows, "recent", null, now);
    expect(keys(g)).toEqual(["day", "week", "month", "older", "never"]);
    expect(firsts(g)).toEqual([0, 1, 2, 3, 4]);
  });

  it("progress has no rail", () => {
    const rows = [ep({ airDate: "2001-01-01" }), ep({ airDate: "1990-01-01" })];
    expect(railKind("progress")).toBeNull();
    expect(deriveRailGroups(rows, "progress")).toEqual([]);
  });

  it("a key that comes back after another group has started empties the rail rather than lying", () => {
    // Years scattered, as a list in any non-date order would have them.
    const rows = [ep({ airDate: "2001-01-01" }), ep({ airDate: "1990-01-01" }), ep({ airDate: "2001-06-01" })];
    expect(deriveRailGroups(rows, "date")).toEqual([]);
  });

  it("a single group is not a rail", () => {
    expect(deriveRailGroups([ep({ airDate: "2001-01-01" }), ep({ airDate: "2001-02-01" })], "date")).toEqual([]);
  });
});

describe("deriveRailGroups — over the real catalogue", () => {
  const seedPath = path.resolve(__dirname, "../../../../public/seed/library.json");
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  // The seed file is not in Dexie's order; the page receives airDate desc.
  const catalogue: Episode[] = (Array.isArray(raw) ? raw : raw.episodes)
    .map((r: Episode, i: number) => ({ ...r, id: i + 1 }))
    .sort((a: Episode, b: Episode) => (b.airDate ?? "").localeCompare(a.airDate ?? ""));

  // Every mode that has a rail must draw one on the real catalogue: a rail that
  // is empty because the sort's key recurs is correct, but for these modes it
  // would mean the grouping was chosen wrongly.
  // Community numbers for a deterministic slice of the catalogue, spread across
  // every play bucket and every star.
  const community: CommunityIndex = new Map(
    catalogue
      .filter((_, i) => i % 7 === 0)
      .map((e, i) => [communityKey(e)!, { plays: (i * 37) % 160, avg: i % 6 === 0 ? 0 : 1 + ((i * 3) % 40) / 10, count: i % 6 === 0 ? 0 : 1 + (i % 9) }]),
  );

  for (const mode of SORT_MODES.filter((m): m is SortMode => railKind(m) !== null)) {
    it(`${mode}: every group starts exactly where its run starts, top to bottom`, () => {
      const withHistory = catalogue.map((e, i) => (i % 29 === 0 ? { ...e, rating: (i % 5) + 1, playCount: i % 13, lastPlayedAt: 1_000_000 + i } : e));
      const rows = sortEpisodes(withHistory, mode, null, community);
      const g = deriveRailGroups(rows, mode, null, 2_000_000, community);
      expect(g.length, `${mode} should have a rail`).toBeGreaterThan(1);
      // Contiguous and exhaustive: each group begins where the last ended.
      expect(g[0].firstIndex).toBe(0);
      for (let i = 1; i < g.length; i++) expect(g[i].firstIndex).toBe(g[i - 1].firstIndex + g[i - 1].count);
      expect(g[g.length - 1].firstIndex + g[g.length - 1].count).toBe(rows.length);
    });
  }

  it("date: the top of the rail is the year of the top row, and the bottom is the bottom row's", () => {
    const g = deriveRailGroups(catalogue, "date");
    expect(g[0].key).toBe(catalogue[0].airDate!.slice(0, 4));
    expect(g[g.length - 1].key).toBe(catalogue[catalogue.length - 1].airDate!.slice(0, 4));
    expect(Number(g[0].key)).toBeGreaterThan(Number(g[g.length - 1].key));
  });

  it("date-asc is the date rail upside down", () => {
    const desc = keys(deriveRailGroups(sortEpisodes(catalogue, "date", null), "date"));
    const asc = keys(deriveRailGroups(sortEpisodes(catalogue, "date-asc", null), "date-asc"));
    expect(asc).toEqual([...desc].reverse());
    expect(asc.length).toBeGreaterThan(10);
  });
});

describe("activeGroupIndex", () => {
  const g = deriveRailGroups(sortEpisodes(DESC, "date", null), "date"); // firsts 0, 2, 4
  it("is the last group starting at or before the row", () => {
    expect([0, 1, 2, 3, 4, 5].map((r) => activeGroupIndex(g, r))).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it("is -1 with no groups", () => {
    expect(activeGroupIndex([], 3)).toBe(-1);
  });
});
