// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog, GUEST_PAGE_MIN } from "@/lib/shows/catalog";
import {
  clip,
  DESCRIPTION_MAX,
  isoDuration,
  longDate,
  readableDuration,
  seriesOf,
  showDescription,
  showPageTitle,
  showSubject,
  type CatalogRow,
} from "@/lib/shows/describe";
import { guestPeople, personKey } from "@/lib/shows/people";
import { relatedShows, RELATED_MAX } from "@/lib/shows/related";
import { looksLikeFileName } from "@/lib/library/display-title";
import { REMOVED_FROM_CATALOG } from "@/lib/library/removed-episodes";
import { monthDay } from "@/lib/shows/describe";

/**
 * Show pages, from the real catalog and the committed slug map, the way the
 * server builds them (docs/show-pages.md).
 */

const { rows, slugs } = readCatalogFiles();
const catalog = buildShowCatalog(rows, slugs);
const AREA_51 = "1992-12-12-area-51-john-lear-bob-lazar";

const row = (r: Partial<CatalogRow>): CatalogRow =>
  ({ fileHash: "archive:x:y.mp3", fileName: "y.mp3", airDate: "1997-03-13", showType: "coast", ...r }) as CatalogRow;

describe("the show catalog", () => {
  it("has a page for every catalog show, by slug and by file", () => {
    expect(catalog.shows.length).toBe(rows.length);
    for (const r of rows) expect(catalog.byHash.get(r.fileHash)?.slug).toBe(slugs[r.fileHash]);
    expect(catalog.bySlug.get(AREA_51)?.row.airDate).toBe("1992-12-12");
  });

  it("gives a pulled episode no page, even with a slug", () => {
    const [hash] = [...REMOVED_FROM_CATALOG.keys()];
    const pulled = row({ fileHash: hash, title: "Coast to Coast AM - Climate Change" });
    const c = buildShowCatalog([...rows, pulled], { ...slugs, [hash]: "2002-03-19-climate-change" });
    expect(c.byHash.has(hash)).toBe(false);
    expect(c.bySlug.has("2002-03-19-climate-change")).toBe(false);
    expect(c.shows.length).toBe(rows.length);
  });

  it("gives a guest a page only with GUEST_PAGE_MIN shows or more, each a real show of theirs", () => {
    expect(catalog.guests.size).toBeGreaterThan(50);
    for (const g of catalog.guests.values()) {
      expect(g.shows.length).toBeGreaterThanOrEqual(GUEST_PAGE_MIN);
      for (const s of g.shows) {
        expect(guestPeople(s.row).map(personKey)).toContain(personKey(g.name));
        expect(catalog.bySlug.get(s.slug)).toBe(s);
      }
    }
    expect(catalog.guests.get("linda-moulton-howe")?.shows.length).toBeGreaterThan(10);
  });
});

describe("guestPeople", () => {
  const people = (guestName: string, title = "Coast to Coast AM - Something") => guestPeople(row({ guestName, title }));

  it("splits names on and, &, and commas", () => {
    expect(people("John Lear and Bob Lazar")).toEqual(["John Lear", "Bob Lazar"]);
    expect(people("Richard C. Hoagland & Ken Johnston")).toEqual(["Richard C. Hoagland", "Ken Johnston"]);
    expect(people("Jeffrey Long, Richard C. Hoagland, and Peter Gersten")).toEqual([
      "Jeffrey Long",
      "Richard C. Hoagland",
      "Peter Gersten",
    ]);
  });

  it("gives a couple's first name the shared surname", () => {
    expect(people("Terry and Linda Jamison")).toEqual(["Terry Jamison", "Linda Jamison"]);
    expect(people("Stan and Holly Deyo and Colm Kelleher")).toEqual(["Stan Deyo", "Holly Deyo", "Colm Kelleher"]);
  });

  it("keeps initials, particles and accents", () => {
    expect(people("Dr. J.J. Hurtak")).toEqual(["Dr. J.J. Hurtak"]);
    expect(people("Erich von Däniken")).toEqual(["Erich von Däniken"]);
    expect(people("Neil deGrasse Tyson")).toEqual(["Neil deGrasse Tyson"]);
  });

  it("yields nobody for a field that is not a list of people", () => {
    for (const g of [
      "Euthanasia & Immigration",
      "The September 11, 2001 Show",
      "Technology, Violence, and the IRS",
      "Weird Person Line",
      "Ghost Buster Gals",
      "Gabriel",
    ]) {
      expect(people(g), g).toEqual([]);
    }
    expect(people("Open Lines", "Coast to Coast AM - Open Lines")).toEqual([]);
  });

  it("one key per person, honorific or not", () => {
    expect(personKey("Dr. Roger Leir")).toBe(personKey("Roger Leir"));
  });
});

describe("naming a show", () => {
  const area51 = catalog.bySlug.get(AREA_51)!.row;

  it("titles it subject, guests, programme and date", () => {
    expect(showPageTitle(area51)).toBe("Area 51 with John Lear and Bob Lazar · Coast to Coast AM, December 12, 1992");
  });

  it("files Midnight in the Desert as its own programme, whatever the show type says", () => {
    expect(seriesOf({ title: "Midnight in the Desert - Open Lines", showType: "special" }).short).toBe("Midnight in the Desert");
    expect(seriesOf({ title: "Dreamland - Crop Circles", showType: "dreamland" }).name).toBe("Dreamland with Art Bell");
    expect(seriesOf({ title: "Special - Art's Farewell", showType: "special" }).short).toBe("Art Bell Special");
    expect(seriesOf({ title: "Coast to Coast AM - X", showType: "special" }).short).toBe("Coast to Coast AM");
  });

  it("never shows a file name as a title, and never an em dash, for any show", () => {
    for (const s of catalog.shows) {
      expect(looksLikeFileName(showSubject(s.row)), s.slug).toBe(false);
      for (const text of [showPageTitle(s.row), showDescription(s.row)]) {
        expect(text, s.slug).not.toContain("—");
        expect(text.trim().length, s.slug).toBeGreaterThan(10);
      }
      expect(showDescription(s.row).length, s.slug).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it("describes it by programme and date first, then the summary", () => {
    expect(showDescription(area51)).toMatch(/^Coast to Coast AM with Art Bell, December 12, 1992\. John Lear and Bob Lazar discuss Area 51/);
    expect(showDescription(row({ title: "Dreamland - Crop Circles", showType: "dreamland", guestName: "Colin Andrews" }))).toBe(
      "Dreamland with Art Bell, March 13, 1997. With Colin Andrews. Listen to the full broadcast free on High Desert.",
    );
  });

  it("dates and durations", () => {
    expect(longDate("1992-12-12")).toBe("December 12, 1992");
    expect(longDate("1999-01-05")).toBe("January 5, 1999");
    expect(longDate("unknown")).toBe("unknown");
    expect(monthDay("1992-12-12")).toBe("12-12");
    expect(isoDuration(7798.39)).toBe("PT2H9M58S");
    expect(isoDuration(3600)).toBe("PT1H");
    expect(isoDuration(59.6)).toBe("PT1M");
    expect(isoDuration(0)).toBeUndefined();
    expect(isoDuration(undefined)).toBeUndefined();
    expect(readableDuration(7798)).toBe("2 h 10 min");
    expect(readableDuration(2880)).toBe("48 min");
  });

  it("clip cuts at a word and marks the cut", () => {
    expect(clip("short", 10)).toBe("short");
    const cut = clip("one two three four five six seven", 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut).toBe("one two three four…");
  });
});

describe("related shows", () => {
  it("for Area 51 (1992): more John Lear and Bob Lazar, the same day in other years, more UFOs", () => {
    const show = catalog.bySlug.get(AREA_51)!;
    const r = relatedShows(show, catalog);
    expect(r.withGuest.length).toBeGreaterThan(0);
    for (const s of r.withGuest) {
      expect(guestPeople(s.row).map(personKey).some((k) => k === "john lear" || k === "bob lazar")).toBe(true);
    }
    for (const s of r.sameDay) {
      expect(monthDay(s.row.airDate)).toBe("12-12");
      expect(s.row.airDate!.slice(0, 4)).not.toBe("1992");
    }
    for (const s of r.category) expect(s.row.aiCategory).toBe("UFOs & Aliens");
    expect(r.category.length).toBe(RELATED_MAX.category);
  });

  it("for every show: bounded, never itself, never twice, always a page that exists", () => {
    let withAny = 0;
    for (const show of catalog.shows) {
      const r = relatedShows(show, catalog);
      expect(r.withGuest.length).toBeLessThanOrEqual(RELATED_MAX.guest);
      expect(r.sameDay.length).toBeLessThanOrEqual(RELATED_MAX.sameDay);
      expect(r.category.length).toBeLessThanOrEqual(RELATED_MAX.category);
      const all = [...r.withGuest, ...r.sameDay, ...r.category];
      expect(new Set(all.map((s) => s.slug)).size, show.slug).toBe(all.length);
      expect(all.map((s) => s.slug), show.slug).not.toContain(show.slug);
      for (const s of all) expect(catalog.bySlug.get(s.slug)).toBe(s);
      if (all.length) withAny++;
    }
    // Every page links onward: a show with no related list at all is a dead end.
    expect(withAny).toBe(catalog.shows.length);
  });
});
