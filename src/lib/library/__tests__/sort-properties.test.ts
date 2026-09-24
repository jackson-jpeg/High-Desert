import { describe, it, expect } from "vitest";
import type { Episode } from "@/db/schema";
import { sortEpisodes, SORT_MODES, type SortMode } from "@/lib/library/filter-episodes";
import { deriveRailGroups, railKind } from "@/lib/library/rail-groups";
import {
  isNumericSort,
  metricFor,
  sortValue,
  type CommunityIndex,
  type CommunityNumbers,
} from "@/lib/library/sort-keys";
import { communityKey } from "@/lib/utils/community-key";
import { prng, randInt } from "@/test-support/prng";

/**
 * Properties of every sort, over random catalogues.
 *
 * The report that started this: "Most played" under a header "Played 2–4 times
 * (2)" followed by a dozen rows reading 41, 6, 78, 120, 27, 20, 132 — no order,
 * one header, and a count that described two rows of twelve. So, for every
 * sort mode and 150 random libraries with random community numbers:
 *
 *   1. the list is monotonic on the sort's own key;
 *   2. the groups tile the list exactly — each group's count is its run of
 *      rows, every row in that run has the group's key, and the counts sum to
 *      the list's length;
 *   3. under a numeric sort, the column shows the number the row sorted by.
 *
 * Seeded: a failure names the seed, and `prng(seed)` reproduces it.
 */

const NOW = 2_000_000_000_000;
const DAY = 86_400_000;

function randomLibrary(seed: number): { rows: Episode[]; community: CommunityIndex } {
  const rand = prng(seed);
  const n = randInt(rand, 1, 80);
  const titles = ["Area 51", "zeta", "Échos", "#1 Night", "Mel's Hole", "ghosts", "Crop Circles", "Y2K"];
  const guests = ["", "Ed Dames", "linda howe", "Élan", "Art Bell", "#guest"];
  // A random date order first, then Dexie's airDate-desc, which is what the
  // page receives and what "date" keeps.
  const rows: Episode[] = Array.from({ length: n }, (_, i) => {
    const year = randInt(rand, 1988, 2013);
    const e: Episode = {
      id: i + 1,
      fileHash: `archive:coll:${seed}-${i}.mp3`,
      fileName: `${seed}-${i}.mp3`,
      archiveIdentifier: "coll",
      title: `${titles[randInt(rand, 0, titles.length - 1)]} ${i}`,
      guestName: guests[randInt(rand, 0, guests.length - 1)] || undefined,
      airDate: rand() < 0.05 ? undefined : `${year}-0${randInt(rand, 1, 9)}-1${randInt(rand, 0, 9)}`,
      playCount: rand() < 0.4 ? randInt(rand, 0, 25) : undefined,
      rating: rand() < 0.3 ? randInt(rand, 1, 5) : undefined,
      lastPlayedAt: rand() < 0.5 ? NOW - randInt(rand, 0, 90) * DAY - randInt(rand, 0, DAY) : undefined,
      createdAt: 0,
      updatedAt: 0,
    } as Episode;
    return e;
  }).sort((a, b) => (b.airDate ?? "").localeCompare(a.airDate ?? ""));

  const community = new Map<string, CommunityNumbers>();
  for (const e of rows) {
    if (rand() < 0.6) {
      const count = rand() < 0.3 ? 0 : randInt(rand, 1, 12);
      community.set(communityKey(e)!, {
        plays: randInt(rand, 0, 160),
        avg: count === 0 ? 0 : Math.round((1 + rand() * 4) * 100) / 100,
        count,
      });
    }
  }
  return { rows, community };
}

/** Each mode's key, and the direction it must never violate. */
function orderKey(mode: SortMode, e: Episode, community: CommunityIndex): number | string {
  if (isNumericSort(mode)) return sortValue(e, mode, community);
  switch (mode) {
    case "date":
    case "date-asc":
      return e.airDate ?? "";
    case "name":
      return (e.title || e.fileName).toLowerCase();
    case "guest":
      return (e.guestName || "").toLowerCase();
    case "recent":
    case "progress":
      return e.lastPlayedAt ?? 0;
  }
}

const DESCENDING: ReadonlySet<SortMode> = new Set(["date", "recent", "progress", "played", "rated", "my-plays", "my-rating"]);

function inOrder(mode: SortMode, a: number | string, b: number | string): boolean {
  if (typeof a === "string" && typeof b === "string") {
    const c = mode === "date" || mode === "date-asc" ? a.localeCompare(b) : a.localeCompare(b);
    return DESCENDING.has(mode) ? c >= 0 : c <= 0;
  }
  return DESCENDING.has(mode) ? a >= b : a <= b;
}

describe("every sort, over random libraries", () => {
  it("the generator gives the community sorts real numbers to order (not all zero)", () => {
    let nonzero = 0;
    let rows = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const lib = randomLibrary(seed);
      rows += lib.rows.length;
      nonzero += lib.rows.filter((e) => sortValue(e, "played", lib.community) > 0).length;
    }
    expect(nonzero / rows).toBeGreaterThan(0.4);
  });

  for (const mode of SORT_MODES) {
    it(`${mode}: monotonic on its own key`, () => {
      for (let seed = 1; seed <= 150; seed++) {
        const { rows, community } = randomLibrary(seed);
        const out = sortEpisodes(rows, mode, null, community);
        // Rows with no date sit at the end of date-asc by design.
        const dated = mode === "date-asc" ? out.filter((e) => e.airDate) : out;
        for (let i = 1; i < dated.length; i++) {
          const a = orderKey(mode, dated[i - 1], community);
          const b = orderKey(mode, dated[i], community);
          expect(inOrder(mode, a, b), `seed ${seed}: ${mode} row ${i - 1} (${a}) then ${i} (${b})`).toBe(true);
        }
      }
    });
  }

  for (const mode of SORT_MODES.filter((m) => railKind(m) !== null)) {
    it(`${mode}: groups tile the list — header counts equal row counts`, () => {
      for (let seed = 1; seed <= 150; seed++) {
        const { rows, community } = randomLibrary(seed);
        const out = sortEpisodes(rows, mode, null, community);
        const groups = deriveRailGroups(out, mode, null, NOW, community);
        if (groups.length === 0) continue; // under two groups, or ungroupable: no headers at all
        expect(groups[0].firstIndex, `seed ${seed}`).toBe(0);
        let total = 0;
        groups.forEach((g, i) => {
          expect(g.firstIndex, `seed ${seed} group ${g.key}`).toBe(total);
          // Every row of the run belongs to this group: regroup the run alone
          // with a sentinel of another key after it and it must be one group.
          const run = out.slice(g.firstIndex, g.firstIndex + g.count);
          const alone = deriveRailGroups([...run, ...out.slice(g.firstIndex + g.count, g.firstIndex + g.count + 1)], mode, null, NOW, community);
          if (i < groups.length - 1) expect(alone[0]?.count, `seed ${seed} group ${g.key}`).toBe(g.count);
          total += g.count;
        });
        expect(total, `seed ${seed}`).toBe(out.length);
      }
    });
  }

  for (const mode of SORT_MODES.filter(isNumericSort)) {
    it(`${mode}: the column shows the number the row sorted by`, () => {
      for (let seed = 1; seed <= 150; seed++) {
        const { rows, community } = randomLibrary(seed);
        for (const e of sortEpisodes(rows, mode, null, community)) {
          const v = sortValue(e, mode, community);
          const text = metricFor(e, mode, community).text;
          if (v === 0) {
            expect(text, `seed ${seed}`).toBe("");
          } else {
            const shown = Number(text.replace(/[^\d.]/g, ""));
            const expected = mode === "rated" ? Number(v.toFixed(1)) : v;
            expect(shown, `seed ${seed}: ${mode} shows "${text}" for ${v}`).toBe(expected);
          }
        }
      }
    });
  }
});
