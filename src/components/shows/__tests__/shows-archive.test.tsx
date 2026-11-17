import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog } from "@/lib/shows/catalog";
import { ShowShell } from "@/components/shows/ShowShell";
import { ShowsIndex, ShowsYearView } from "@/components/shows/ShowsArchive";
import { byMonth, showYear, showYears } from "@/lib/shows/archive";
import { showsIndexJsonLd, showsYearJsonLd } from "@/lib/shows/jsonld";
import sitemap from "@/app/sitemap";
import { validateJsonLd } from "../../../../scripts/lib/jsonld-check.mjs";

/**
 * The archive by year (docs/show-pages.md, "The archive by year"): every show
 * page reachable in two hops from /shows, as plain links in the server HTML,
 * and /shows linked from every page in the show pages' frame.
 */

const { rows, slugs } = readCatalogFiles();
const catalog = buildShowCatalog(rows, slugs);
const years = showYears(catalog);

function doc(el: ReturnType<typeof createElement>): Document {
  const html = renderToStaticMarkup(createElement(ShowShell, null, el));
  return new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`, "text/html");
}

const hrefs = (d: Document, sel = "a[href]") => [...d.querySelectorAll(sel)].map((a) => a.getAttribute("href")!);

describe("the archive by year", () => {
  it("puts every dated show under exactly one year, in air order", () => {
    const dated = catalog.shows.filter((s) => /^\d{4}-/.test(s.row.airDate ?? ""));
    const listed = years.flatMap((y) => y.shows);
    expect(listed.length).toBe(dated.length);
    expect(new Set(listed.map((s) => s.slug)).size).toBe(listed.length);
    for (const y of years) {
      expect(y.shows.every((s) => s.row.airDate!.startsWith(`${y.year}-`))).toBe(true);
      const dates = y.shows.map((s) => s.row.airDate!);
      expect([...dates].sort()).toEqual(dates);
    }
    expect(years.map((y) => y.year)).toEqual([...years.map((y) => y.year)].sort());
  });

  it("reaches every show page in two hops from /shows", () => {
    const index = doc(createElement(ShowsIndex, { years }));
    const yearLinks = hrefs(index, ".hd-shows-years a");
    expect(yearLinks).toEqual(years.map((y) => `/shows/${y.year}`));

    const reached = new Set<string>();
    for (const y of years) {
      const found = showYear(catalog, y.year)!;
      const page = doc(createElement(ShowsYearView, found));
      for (const h of hrefs(page, ".hd-show-list a")) reached.add(h);
      expect(page.querySelectorAll("h1")).toHaveLength(1);
      expect(page.querySelector(`article[data-year="${y.year}"]`)).not.toBeNull();
    }
    const dated = catalog.shows.filter((s) => /^\d{4}-/.test(s.row.airDate ?? ""));
    expect(dated.length).toBeGreaterThan(1000);
    for (const s of dated) expect(reached.has(`/show/${s.slug}`), s.slug).toBe(true);
  });

  it("links each year to its neighbours and back to the index", () => {
    const mid = years[Math.floor(years.length / 2)].year;
    const found = showYear(catalog, mid)!;
    const nav = hrefs(doc(createElement(ShowsYearView, found)), ".hd-shows-year-nav a");
    expect(nav).toContain(`/shows/${found.prev}`);
    expect(nav).toContain(`/shows/${found.next}`);
    expect(nav).toContain("/shows");
    expect(showYear(catalog, years[0].year)!.prev).toBeNull();
    expect(showYear(catalog, years[years.length - 1].year)!.next).toBeNull();
    // Control: a year with no show has no page.
    expect(showYear(catalog, "1900")).toBeNull();
  });

  it("groups a year by month, in order", () => {
    const months = byMonth(years[0].shows);
    expect(months.flatMap((m) => m.shows)).toEqual(years[0].shows);
    expect(new Set(months.map((m) => m.month)).size).toBe(months.length);
  });

  it("is linked from the frame every show, guest, topic and Tonight page uses", () => {
    const page = doc(createElement("p", null, "x"));
    expect(hrefs(page, ".hd-show-nav a")).toContain("/shows");
    expect(hrefs(page, ".hd-show-footer a")).toContain("/shows");
  });

  it("is in the sitemap, every year with it", () => {
    const urls = new Set(sitemap().map((e) => new URL(e.url).pathname));
    expect(urls.has("/shows")).toBe(true);
    for (const y of years) expect(urls.has(`/shows/${y.year}`), y.year).toBe(true);
  });

  it("has valid schema.org JSON-LD", () => {
    expect(validateJsonLd(showsIndexJsonLd(years))).toEqual([]);
    for (const y of years) expect(validateJsonLd(showsYearJsonLd(y.year, y.shows)), y.year).toEqual([]);
  });

  it("says no em dash", () => {
    const text = [doc(createElement(ShowsIndex, { years })), doc(createElement(ShowsYearView, showYear(catalog, years[0].year)!))]
      .map((d) => d.body.textContent ?? "")
      .join("\n");
    expect(text).not.toContain("—");
  });
});
