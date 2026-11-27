import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ERAS, eraOf, eraOfYear } from "@/lib/era/era";
import type { Episode } from "@/db/schema";
import { EpisodeCard } from "@/components/library/EpisodeCard";
import { LookProvider } from "@/hooks/useLook";
import { LibraryListSkeleton } from "@/components/library/LibraryListStates";
import { YearDial } from "@/components/radio/YearDial";
import { ERA_STRIP_COLOR } from "@/components/radio/TuningStrip";
import { PALETTE } from "@/lib/palette";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog } from "@/lib/shows/catalog";
import { ShowView } from "@/components/shows/ShowView";
import { ShowsIndex } from "@/components/shows/ShowsArchive";
import { showYears } from "@/lib/shows/archive";

/**
 * Era colours (docs/UI-PLAN.md, push 3): every year of the archive belongs to
 * an era, each era has a colour that passes on the surface it is drawn on, and
 * the Library, the dial, the show pages and the shelf of years carry it.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const src = path.resolve(import.meta.dirname, "../../..");
const globals = readFileSync(path.join(src, "app/globals.css"), "utf8");
const eraCss = readFileSync(path.join(src, "styles/era.css"), "utf8");
const token = (name: string) => {
  const m = new RegExp(`--hd-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(globals);
  expect(m, name).not.toBeNull();
  return m![1];
};
function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("the eras", () => {
  it("cover every year in the catalog, one era each, in order, with no gaps", () => {
    const years = new Set(readCatalogFiles().rows.map((r) => Number((r.airDate ?? "").slice(0, 4))).filter((y) => y > 1900));
    for (const y of years) expect(eraOfYear(y), String(y)).not.toBeNull();
    for (let i = 1; i < ERAS.length; i++) expect(ERAS[i].from).toBe(ERAS[i - 1].to + 1);
    expect(eraOf("1997-03-13")).toBe("peak");
    expect(eraOf("2015-12-08")).toBe("desert");
    expect(eraOf(null)).toBeNull();
    expect(eraOfYear(1980)).toBeNull();
  });

  it("each era's bright colour passes on the dark surfaces, its deep one on white", () => {
    for (const { key } of ERAS) {
      expect(contrast(token(`era-${key}`), token("raised")), `${key} on raised`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(`era-${key}`), token("midnight")), `${key} on midnight`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(`era-${key}-deep`), token("chrome-lighter")), `${key}-deep on white`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("era.css maps every era, and never sets the deep colour as text on Win98's gray face", () => {
    for (const { key } of ERAS) {
      expect(eraCss).toContain(`[data-era="${key}"] { --era: var(--hd-era-${key}); --era-deep: var(--hd-era-${key}-deep); }`);
    }
    // The deep colour is text only where the surface is white: rows and year headers in the list.
    const deepText = [...eraCss.matchAll(/([^{}]+)\{[^}]*?(?:^|[;{\s])color:\s*var\(--era-deep\)/g)].map((m) => m[1].trim());
    expect(deepText.length).toBeGreaterThan(0);
    for (const sel of deepText) expect(sel, sel).toMatch(/\.hd-era-(row|header)/);
  });

  it("the tuning strip draws each era in its bright colour", () => {
    for (const { key } of ERAS) {
      const cap = key[0].toUpperCase() + key.slice(1);
      expect(ERA_STRIP_COLOR[key]).toBe(PALETTE[`era${cap}` as keyof typeof PALETTE]);
    }
  });
});

describe("where the eras show", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const ep = (airDate: string | undefined) =>
    ({ id: 7, fileHash: "archive:coll:7.mp3", fileName: "7.mp3", archiveIdentifier: "coll", title: "Coast to Coast AM - Area 51", airDate, showType: "coast", duration: 3600, playCount: 0 }) as unknown as Episode;

  for (const look of ["win98", "night"] as const) {
    it(`${look}: a Library row carries its era, and its date is marked to take the colour`, () => {
      act(() => root.render(createElement(LookProvider, { look }, createElement(EpisodeCard, { episode: ep("1997-07-28"), onClick: () => {} }) as ReactNode)));
      const row = host.querySelector<HTMLElement>('[role="option"]')!;
      expect(row.dataset.era).toBe("peak");
      expect(row.classList.contains("hd-era-row")).toBe(true);
      expect(row.querySelector(".hd-era-date")?.textContent).toMatch(/1997/);
    });
  }

  it("a row with no date has no era", () => {
    act(() => root.render(createElement(LookProvider, { look: "night" }, createElement(EpisodeCard, { episode: ep(undefined), onClick: () => {} }) as ReactNode)));
    expect(host.querySelector<HTMLElement>('[role="option"]')!.hasAttribute("data-era")).toBe(false);
  });

  it("a show page carries its era as a band", () => {
    const { rows, slugs } = readCatalogFiles();
    const catalog = buildShowCatalog(rows, slugs);
    const show = catalog.bySlug.get("1992-12-12-area-51-john-lear-bob-lazar")!;
    const html = renderToStaticMarkup(createElement(ShowView, { show, catalog }));
    expect(html).toMatch(/class="hd-show-article hd-era-band[^"]*"[^>]*data-era="early"/);
  });

  it("the shelf of years gives every year its era", () => {
    const { rows, slugs } = readCatalogFiles();
    const years = showYears(buildShowCatalog(rows, slugs));
    const html = renderToStaticMarkup(createElement(ShowsIndex, { years }));
    const spines = [...html.matchAll(/data-era="(\w+)"[^>]*class="hd-show-topic hd-era-spine/g)];
    expect(spines.length).toBe(years.length);
  });

  it("the dial's scale has a band per era", () => {
    const html = renderToStaticMarkup(createElement(YearDial, { airDate: null }));
    for (const { key } of ERAS) expect(html).toContain(`data-era="${key}"`);
  });

  it("the Library loads as the station tuning in, announced, with no grey bars", () => {
    const html = renderToStaticMarkup(createElement(LibraryListSkeleton));
    expect(html).toContain('role="status"');
    expect(html).toContain("Tuning in to the archive");
    expect(html).not.toContain("animate-skeleton");
    expect(html).not.toContain("—");
    const css = eraCss.slice(eraCss.indexOf("The Library tuning in"));
    const gate = css.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(css.slice(0, gate)).not.toMatch(/animation:/);
  });
});
