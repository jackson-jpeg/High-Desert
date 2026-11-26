import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog } from "@/lib/shows/catalog";
import { personKey } from "@/lib/shows/people";
import { showCrumbs } from "@/lib/shows/jsonld";
import { showYear } from "@/lib/shows/archive";
import { ShowsYearView } from "@/components/shows/ShowsArchive";
import { NOT_A_GUEST, shownGuest } from "@/lib/library/guest";
import { archiveDetailsUrl } from "@/lib/library/episode-detail";
import type { Episode } from "@/db/schema";

/**
 * Duet's site review of 2026-11-26 (docs/site-review-duet.md), the fixes that
 * were built, each held here against the real catalog and the real files.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const { rows, slugs } = readCatalogFiles();
const catalog = buildShowCatalog(rows, slugs);

describe("fix 1: About's source link names the catalog's own archive.org item", () => {
  it("links the collection most of the catalog comes from", () => {
    const counts = new Map<string, number>();
    for (const r of rows as { archiveIdentifier?: string }[]) {
      if (r.archiveIdentifier) counts.set(r.archiveIdentifier, (counts.get(r.archiveIdentifier) ?? 0) + 1);
    }
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const links = [...read("src/components/desktop/AboutDialog.tsx").matchAll(/archive\.org\/details\/([\w.-]+)/g)].map((m) => m[1]);
    expect(links).toEqual([main]);
  });
});

describe("fix 2 and 3: the welcome copy says what is true", () => {
  const files = [
    "src/app/[look]/page.tsx",
    "src/app/[look]/layout.tsx",
    "src/app/[look]/(desktop)/library/layout.tsx",
    "public/manifest.json",
    "src/components/desktop/AboutDialog.tsx",
  ];

  it("never claims thousands of episodes; 'over 1,400' holds for the catalog", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/thousands/i);
    expect(rows.length).toBeGreaterThan(1400);
    expect(read("src/app/[look]/page.tsx")).toContain("over 1,400 episodes");
  });

  it("puts no unsourced quote in Art Bell's mouth", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/cannot explain/i);
  });
});

describe("fix 4: guests", () => {
  it("clears the four show titles from the seed, and hides them on a library seeded before", () => {
    const byHash = new Map(rows.map((r) => [r.fileHash, r]));
    expect(Object.keys(NOT_A_GUEST)).toHaveLength(4);
    for (const [hash, old] of Object.entries(NOT_A_GUEST)) {
      const row = byHash.get(hash);
      expect(row, hash).toBeDefined();
      expect((row as { guestName?: string }).guestName).toBeUndefined();
      expect(shownGuest({ title: row!.title, guestName: old, fileHash: hash })).toBeUndefined();
      // The same words on another row are not touched: exact row, exact value.
      expect(shownGuest({ title: row!.title, guestName: old, fileHash: "archive:x:y.mp3" })).toBe(old);
    }
  });

  it("puts each spelling of one person on one guest page", () => {
    const wolf = catalog.guests.get("robert-ghost-wolf")!;
    const sky = catalog.guests.get("robert-morningsky")!;
    expect(wolf.name).toBe("Robert Ghost Wolf");
    expect(sky.name).toBe("Robert Morningsky");
    expect(wolf.shows.filter((s) => /ghostwolf/i.test(s.row.guestName ?? ""))).toHaveLength(3);
    expect(sky.shows.filter((s) => /morning sky/i.test(s.row.guestName ?? ""))).toHaveLength(1);
    expect(catalog.guests.has("robert-ghostwolf")).toBe(false);
    expect(catalog.guests.has("robert-morning-sky")).toBe(false);
  });

  it("resolves the old pages' slugs to the merged page, which is how they redirect", () => {
    const moved = (slug: string) => catalog.guestSlugByPerson.get(personKey(slug.replace(/-/g, " ")));
    expect(moved("robert-ghostwolf")).toBe("robert-ghost-wolf");
    expect(moved("robert-morning-sky")).toBe("robert-morningsky");
    expect(moved("spooky-matter")).toBeUndefined();
    const page = read("src/app/[look]/guest/[slug]/page.tsx");
    expect(page).toMatch(/permanentRedirect\(`\/guest\/\$\{moved\}`\)/);
  });
});

describe("fix 5: the archive.org link is a valid URL", () => {
  it("encodes spaces, & and ' in the file name", () => {
    const e = { archiveIdentifier: "coll", fileName: "1998-01-05 - Art & Ramona's  Show.mp3" } as Episode;
    expect(archiveDetailsUrl(e)).toBe("https://archive.org/details/coll/1998-01-05%20-%20Art%20%26%20Ramona's%20%20Show.mp3");
    expect(() => new URL(archiveDetailsUrl(e)!)).not.toThrow();
    expect(archiveDetailsUrl(e)).not.toMatch(/ /);
  });
});

describe("fix 6: the archive pages say they are the archive", () => {
  it("titles /shows and /shows/<year> 'Archive' in the Win98 look", () => {
    const css = read("src/styles/show-pages.css");
    expect(css).toMatch(
      /\.hd-show-article\.hd-shows-index::before,\s*html\[data-look="win98"\] \.hd-show-article\.hd-shows-year::before \{\s*content: "High Desert - Archive";/,
    );
  });

  it("reads naturally for a year with one show", () => {
    const found = showYear(catalog, "1992")!;
    expect(found.year.shows).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(ShowsYearView, found));
    expect(html).toContain("The one show from 1992 in the archive.");
    expect(html).not.toContain("1 show from 1992");
  });
});

describe("fix 8: On This Day has room on a desktop", () => {
  it("is no shorter on desktop than on a phone", () => {
    expect(read("src/components/library/OnThisDay.tsx")).toContain("max-h-[200px] md:max-h-[220px]");
  });
});

describe("fix 10: a show's breadcrumb goes through the archive", () => {
  it("High Desert, Every show, its year, the show", () => {
    const area51 = catalog.bySlug.get("1992-12-12-area-51-john-lear-bob-lazar")!;
    const crumbs = showCrumbs(area51);
    expect(crumbs.map((c) => c.path)).toEqual(["/", "/shows", "/shows/1992", "/show/1992-12-12-area-51-john-lear-bob-lazar"]);
    expect(crumbs.map((c) => c.name).slice(0, 3)).toEqual(["High Desert", "Every show", "1992"]);
  });
});
