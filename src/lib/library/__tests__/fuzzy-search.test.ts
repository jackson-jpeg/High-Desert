import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Episode } from "@/db/schema";
import { editDistance, fuzzyTextMatch, correctedSearch, maxEdits } from "@/lib/library/fuzzy-search";
import { filterEpisodesSpelled, selectLibraryView, type LibraryCriteria } from "@/lib/library/filter-episodes";

/**
 * Close spellings in the Library search (docs/library-search.md). Driven
 * through the real pipeline against the real catalog: the misspellings are
 * the ones that found nothing before (NEXT.md, 2026-11-17).
 */

const catalog: Episode[] = (
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/seed/library.json"), "utf8")) as Episode[]
).map((e, i) => ({ ...e, id: i + 1 }));

const NONE: LibraryCriteria = {
  search: "",
  showFilter: "all",
  favoritesOnly: false,
  guestFilter: null,
  categoryFilter: null,
  seriesFilter: null,
};

const search = (q: string, extra: Partial<LibraryCriteria> = {}) => filterEpisodesSpelled(catalog, { ...NONE, ...extra, search: q });
const guests = (eps: Episode[]) => eps.map((e) => `${e.guestName ?? ""} ${e.title ?? ""}`.toLowerCase());

describe("editDistance", () => {
  it("counts inserts, deletes, substitutions and a swap of neighbours as one each", () => {
    expect(editDistance("lazaar", "lazar", 2)).toBe(1);
    expect(editDistance("hogland", "hoagland", 2)).toBe(1);
    expect(editDistance("haogland", "hoagland", 2)).toBe(1);
    expect(editDistance("hoaglond", "hoagland", 2)).toBe(1);
    expect(editDistance("cost", "coast", 2)).toBe(1);
    expect(editDistance("same", "same", 0)).toBe(0);
  });
  it("stops at the limit", () => {
    expect(editDistance("abcdef", "uvwxyz", 1)).toBe(2);
    expect(editDistance("a", "abcd", 1)).toBe(2);
  });
  it("lets short words be exact only", () => {
    expect(maxEdits("ufo")).toBe(0);
    expect(maxEdits("mars")).toBe(1);
    expect(maxEdits("hoagland")).toBe(2);
  });
});

describe("the Library search forgives spelling", () => {
  it.each([
    ["Lazaar", "lazar"],
    ["Hogland", "hoagland"],
    ["Richard Hoaglund", "hoagland"],
    ["Coast to Cost", "coast"],
  ])("%s finds shows, and says what it read", (q, word) => {
    // Control: nothing exact, which is why the fallback exists.
    const exact = catalog.filter((e) =>
      [e.fileName, e.title, e.guestName, e.topic, e.airDate, e.description, e.aiCategory, e.aiSeries, ...(e.aiTags ?? [])]
        .some((f) => f?.toLowerCase().includes(q.toLowerCase())),
    );
    expect(exact).toEqual([]);

    const { episodes, spelling } = search(q);
    expect(episodes.length).toBeGreaterThan(0);
    // Every show naming the intended word is found. Not "every result names
    // it": a misspelling can sit one edit from two real words ("hogland" is
    // also close to another catalog word), and both are fair matches.
    const meant = catalog.filter((e) => guests([e])[0].includes(word));
    expect(meant.length).toBeGreaterThan(0);
    const found = new Set(episodes.map((e) => e.id));
    expect(meant.every((e) => found.has(e.id))).toBe(true);
    expect(spelling).not.toBeNull();
    expect(correctedSearch(q, spelling!)!.toLowerCase()).toContain(word);
  });

  it("every query word must be met: a close spelling of one word never brings in shows with only the other", () => {
    const row = (id: number, guestName: string) => ({ ...catalog[0], id, guestName, title: guestName, aiTags: [], aiSummary: "", aiCategory: undefined, aiSeries: undefined }) as Episode;
    const list = [row(1, "Bob Lazar"), row(2, "Bob Smith"), row(3, "Mary Lazar")];
    const { episodes } = fuzzyTextMatch(list, "bob lazaar");
    expect(episodes.map((e) => e.id)).toEqual([1]);
    // Control: each word alone finds its own shows, so the two-word result is an intersection.
    expect(fuzzyTextMatch(list, "lazaar").episodes.map((e) => e.id)).toEqual([1, 3]);
  });

  it("finds the Area 51 night for 'Bob Lazaar'", () => {
    const { episodes } = search("Bob Lazaar");
    expect(episodes.some((e) => e.guestName === "John Lear and Bob Lazar")).toBe(true);
  });

  it("never touches an exact match: the result is the exact one and no note", () => {
    const { episodes, spelling } = search("Lazar");
    expect(spelling).toBeNull();
    expect(episodes.every((e) => guests([e])[0].includes("lazar") || JSON.stringify(e).toLowerCase().includes("lazar"))).toBe(true);
  });

  it("still finds nothing for nonsense", () => {
    const { episodes, spelling } = search("qwxzvbnm");
    expect(episodes).toEqual([]);
    expect(spelling).toBeNull();
  });

  it("keeps the other criteria: a show filter narrows the close spellings too", () => {
    const all = search("Hogland").episodes;
    const dream = search("Hogland", { showFilter: "dreamland" }).episodes;
    expect(dream.length).toBeLessThan(all.length);
    expect(dream.every((e) => e.showType === "dreamland")).toBe(true);
  });

  it("keeps operators as typed when correcting", () => {
    const { spelling } = search("year:1996 Hogland");
    expect(spelling).not.toBeNull();
    expect(correctedSearch("year:1996 Hogland", spelling!)).toBe("year:1996 hoagland");
  });

  it("selectLibraryView carries the note through the sort", () => {
    const view = selectLibraryView(catalog, { ...NONE, search: "Lazaar", sortMode: "name" });
    expect(view.spelling).not.toBeNull();
    expect(view.episodes.length).toBeGreaterThan(0);
  });

  it("a prefix still being typed is not called a misspelling", () => {
    const { corrections } = fuzzyTextMatch(catalog, "hoagl marss");
    expect(corrections.map((c) => c.from)).toEqual(["marss"]);
  });
});
