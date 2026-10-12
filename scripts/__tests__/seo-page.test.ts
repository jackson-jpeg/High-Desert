import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pageFindings, evenSample, sitePath } from "../lib/seo-page.mjs";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog } from "@/lib/shows/catalog";
import { ShowShell } from "@/components/shows/ShowShell";
import { ShowView } from "@/components/shows/ShowView";
import { showMetadata } from "@/lib/shows/metadata";
import { showPath, SITE_ORIGIN } from "@/lib/shows/describe";
import sitemap from "@/app/sitemap";

/**
 * scripts/seo-check.mjs's page rules (scripts/lib/seo-page.mjs), against a
 * show page assembled the way Next serves it: the <head> tags showMetadata
 * asks for, the body ShowView renders. A good page passes; each thing a
 * search engine needs, taken away, is a finding.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const { rows, slugs } = readCatalogFiles(ROOT);
const catalog = buildShowCatalog(rows, slugs);
const show = catalog.bySlug.get("1992-12-12-area-51-john-lear-bob-lazar")!;
const BASE = "http://127.0.0.1:3201";
const PATH = showPath(show.slug);

function goodHtml(): string {
  const m = showMetadata(show);
  const og = m.openGraph as Record<string, string>;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const head = [
    `<title>${esc(String(m.title))} | High Desert</title>`,
    `<meta name="description" content="${esc(String(m.description))}">`,
    `<link rel="canonical" href="${SITE_ORIGIN}${PATH}">`,
    `<meta property="og:title" content="${esc(og.title)}">`,
    `<meta property="og:description" content="${esc(og.description)}">`,
    `<meta property="og:url" content="${SITE_ORIGIN}${PATH}">`,
    `<meta property="og:image" content="${SITE_ORIGIN}${PATH}/opengraph-image?abc">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image" content="${SITE_ORIGIN}${PATH}/twitter-image?abc">`,
  ].join("");
  const body = renderToStaticMarkup(createElement(ShowShell, null, createElement(ShowView, { show, catalog })));
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

const check = (html: string) =>
  pageFindings(new DOMParser().parseFromString(html, "text/html"), { path: PATH, kind: "show", base: BASE });

describe("pageFindings", () => {
  it("passes a real show page, and collects its links and share images", () => {
    const r = check(goodHtml());
    expect(r.findings).toEqual([]);
    expect(r.links).toContain("/library");
    expect(r.links.some((l: string) => l.startsWith("/show/") && l !== PATH)).toBe(true);
    expect(r.links.some((l: string) => l.startsWith("/guest/"))).toBe(true);
    expect(r.images).toEqual([`${PATH}/opengraph-image?abc`, `${PATH}/twitter-image?abc`]);
  });

  const broken: [string, (h: string) => string, RegExp][] = [
    ["no title", (h) => h.replace(/<title>[^<]*<\/title>/, ""), /no <title>/],
    ["no description", (h) => h.replace(/<meta name="description"[^>]*>/, ""), /no meta description/],
    ["no canonical", (h) => h.replace(/<link rel="canonical"[^>]*>/, ""), /no canonical/],
    ["a canonical elsewhere", (h) => h.replace(`href="${SITE_ORIGIN}${PATH}"`, `href="${SITE_ORIGIN}/"`), /canonical .* is not this page/],
    ["no og:image", (h) => h.replace(/<meta property="og:image"[^>]*>/, ""), /no og:image/],
    ["no og:url", (h) => h.replace(/<meta property="og:url"[^>]*>/, ""), /no og:url/],
    ["no og:title", (h) => h.replace(/<meta property="og:title"[^>]*>/, ""), /no og:title/],
    ["no twitter card", (h) => h.replace(/<meta name="twitter:card"[^>]*>/, ""), /twitter:card/],
    ["JSON-LD that does not parse", (h) => h.replace('"@type":"PodcastEpisode"', '"@type":"PodcastEpisode",,'), /does not parse/],
    ["invalid JSON-LD", (h) => h.replace('"datePublished":"1992-12-12"', '"datePublished":"December 12"'), /datePublished: invalid/],
    ["no episode JSON-LD", (h) => h.replace('"@type":"PodcastEpisode"', '"@type":"CreativeWorkX"'), /no PodcastEpisode/],
    ["no h1", (h) => h.replace(/<h1[\s\S]*?<\/h1>/, ""), /<h1>/],
    ["no audio", (h) => h.replace(/<audio[\s\S]*?<\/audio>/, ""), /audio/],
    ["an audio that preloads", (h) => h.replace('preload="none"', 'preload="auto"'), /preload=none/],
    ["no Open in High Desert", (h) => h.replace(/class="hd-show-open[^"]*"/, 'class="x"'), /Open in High Desert/],
    ["the boot screen left over the page", (h) => h.replace("#app-loading{display:none!important}", ""), /#app-loading/],
    ["an em dash", (h) => h.replace("Area 51 with John Lear", "Area 51 — John Lear"), /em dash/],
    ["the page drawn only by JavaScript", (h) => h.replace(/<div class="hd-show-page[\s\S]*<\/body>/, '<div id="root"></div></body>'), /not in the server HTML/],
  ];
  for (const [what, breakIt, finding] of broken) {
    it(`finds ${what}`, () => {
      const html = breakIt(goodHtml());
      expect(html, "the fixture changed").not.toBe(goodHtml());
      expect(check(html).findings.join("\n")).toMatch(finding);
    });
  }
});

describe("sitePath", () => {
  it("maps the site's absolute URLs and relative ones onto the server under test", () => {
    expect(sitePath("https://highdesert.space/show/x", BASE)).toBe("/show/x");
    expect(sitePath("/library?q=ufo", BASE)).toBe("/library?q=ufo");
    expect(sitePath(`${BASE}/live`, BASE)).toBe("/live");
    expect(sitePath("https://archive.org/details/x", BASE)).toBeNull();
  });
});

describe("evenSample", () => {
  it("is spread through the list and the same every run", () => {
    const items = Array.from({ length: 100 }, (_, i) => `s${String(i).padStart(3, "0")}`);
    const a = evenSample(items, 10);
    expect(a).toHaveLength(10);
    expect(a[0]).toBe("s000");
    expect(a[9]).toBe("s090");
    expect(evenSample([...items].reverse(), 10)).toEqual(a);
    expect(evenSample(["b", "a"], 5)).toEqual(["a", "b"]);
  });
});

describe("sitemap.xml and robots.txt", () => {
  it("lists the app's routes, every show page and every guest page", () => {
    const urls = new Set(sitemap().map((e) => e.url));
    for (const p of ["", "/library", "/live", "/stats"]) expect(urls.has(`${SITE_ORIGIN}${p}`), p).toBe(true);
    for (const s of catalog.shows) expect(urls.has(`${SITE_ORIGIN}/show/${s.slug}`), s.slug).toBe(true);
    for (const g of catalog.guests.keys()) expect(urls.has(`${SITE_ORIGIN}/guest/${g}`), g).toBe(true);
    expect(urls.size).toBe(4 + catalog.shows.length + catalog.guests.size);
  });

  it("robots keeps crawlers out of the API, admin pages and /look, and names the sitemap", () => {
    const robots = readFileSync(path.join(ROOT, "public/robots.txt"), "utf8").split("\n").map((l) => l.trim());
    for (const rule of ["Disallow: /api/", "Disallow: /scanner", "Disallow: /search", "Disallow: /look"]) expect(robots).toContain(rule);
    expect(robots).toContain("Sitemap: https://highdesert.space/sitemap.xml");
    expect(robots.filter((l) => /^Disallow: \/(show|guest)/.test(l))).toEqual([]);
  });
});
