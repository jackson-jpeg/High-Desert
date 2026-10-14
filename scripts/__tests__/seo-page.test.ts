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
import { momentMetadata, showMetadata, topicMetadata, tonightMetadata } from "@/lib/shows/metadata";
import { showPath, SITE_ORIGIN } from "@/lib/shows/describe";
import sitemap from "@/app/sitemap";
import { buildTopicCatalog } from "@/lib/topics/catalog";
import { readTopicSlugs } from "@/lib/topics/load";
import { TopicView } from "@/components/topics/TopicView";
import { TonightView } from "@/components/tonight/TonightView";
import { pacificDay } from "@/lib/live/schedule";
import { tonightPage, tonightSitemapDays } from "@/lib/tonight/tonight";
import type { Metadata } from "next";
import type { ReactElement } from "react";

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

/** A page as Next serves it: the head tags `m` asks for (share images as named, else beside the page), the body. */
function pageHtml(m: Metadata, pagePath: string, body: ReactElement): string {
  const og = m.openGraph as Record<string, unknown>;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const firstUrl = (v: unknown) => {
    const one = Array.isArray(v) ? v[0] : v;
    return one ? String(typeof one === "object" ? (one as { url: unknown }).url : one) : null;
  };
  const ogImage = firstUrl(og.images) ?? `${pagePath.split("?")[0]}/opengraph-image?abc`;
  const twImage = firstUrl((m.twitter as Record<string, unknown> | undefined)?.images) ?? `${pagePath.split("?")[0]}/twitter-image?abc`;
  const abs = (u: string) => (u.startsWith("http") ? u : `${SITE_ORIGIN}${u}`);
  const canonical = String(m.alternates?.canonical ?? pagePath);
  const head = [
    `<title>${esc(String(m.title))} | High Desert</title>`,
    `<meta name="description" content="${esc(String(m.description))}">`,
    `<link rel="canonical" href="${abs(canonical)}">`,
    `<meta property="og:title" content="${esc(String(og.title))}">`,
    `<meta property="og:description" content="${esc(String(og.description))}">`,
    `<meta property="og:url" content="${abs(String(og.url ?? pagePath))}">`,
    `<meta property="og:image" content="${abs(ogImage)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image" content="${abs(twImage)}">`,
  ].join("");
  return `<!doctype html><html><head>${head}</head><body>${renderToStaticMarkup(createElement(ShowShell, null, body))}</body></html>`;
}

function goodHtml(): string {
  return pageHtml({ ...showMetadata(show), alternates: { canonical: PATH } }, PATH, createElement(ShowView, { show, catalog }));
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
    expect(r.images).toEqual([`${PATH}/opengraph-image`, `${PATH}/twitter-image`]);
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

const topics = buildTopicCatalog(catalog, readTopicSlugs());
const MOMENT = 5025;
const MOMENT_PATH = `${PATH}?t=${MOMENT}`;
const momentHtml = () =>
  pageHtml(momentMetadata(show, MOMENT), MOMENT_PATH, createElement(ShowView, { show, catalog, moment: MOMENT }));
const mel = topics.bySlug.get("mels-hole")!;
const topicHtml = () => pageHtml(topicMetadata(mel), `/topic/${mel.slug}`, createElement(TopicView, { topic: mel, catalog: topics }));
const DAY = "2026-10-12";
const tonightHtml = () => {
  const page = tonightPage(DAY, null, catalog);
  return pageHtml(
    tonightMetadata(DAY, page.title, page.description),
    `/tonight/${DAY}`,
    createElement(TonightView, { day: DAY, today: DAY, page, available: false, prev: false, next: false }),
  );
};
const checkKind = (html: string, path: string, kind: "show" | "guest" | "topic" | "tonight" | "moment") =>
  pageFindings(new DOMParser().parseFromString(html, "text/html"), { path, kind, base: BASE });

describe("pageFindings: a shared moment", () => {
  it("passes a real moment page: canonical the show, og:url the moment, the moment's card", () => {
    const r = checkKind(momentHtml(), MOMENT_PATH, "moment");
    expect(r.findings).toEqual([]);
    expect(r.images[0]).toBe(`${PATH}/moment/${MOMENT}/opengraph-image`);
  });

  const broken: [string, (h: string) => string, RegExp][] = [
    ["a player that starts at the top", (h) => h.replaceAll(`#t=${MOMENT}`, ""), /does not start at/],
    ["no word of where it starts", (h) => h.replace(/data-moment="\d+"/, ""), /does not say where the moment starts/],
    ["an Open link without the moment", (h) => h.replace(`&amp;t=${MOMENT}`, ""), /does not carry the moment/],
    ["the plain card", (h) => h.replaceAll(`/moment/${MOMENT}/opengraph-image`, "/opengraph-image"), /not the moment's card/],
    ["a canonical with the query", (h) => h.replace(`<link rel="canonical" href="${SITE_ORIGIN}${PATH}">`, `<link rel="canonical" href="${SITE_ORIGIN}${MOMENT_PATH}">`), /canonical .* is not this page/],
    ["a Play button JavaScript-off visitors see", (h) => h.replace(".hd-show-play{display:none!important}", ""), /hides the Play button/],
    ["an intro that never names the site", (h) => h.replace("High Desert plays Art Bell", "This site plays Art Bell"), /no one-line intro/],
    ["an intro with no way into Live", (h) => h.replace('href="/live">Listen to the station now', 'href="/stats">Listen to the station now'), /no way into Live/],
  ];
  for (const [what, breakIt, finding] of broken) {
    it(`finds ${what}`, () => {
      const html = breakIt(momentHtml());
      expect(html, "the fixture changed").not.toBe(momentHtml());
      expect(checkKind(html, MOMENT_PATH, "moment").findings.join("\n")).toMatch(finding);
    });
  }
});

describe("pageFindings: topic and Tonight pages", () => {
  it("passes a real topic page", () => {
    expect(checkKind(topicHtml(), `/topic/${mel.slug}`, "topic").findings).toEqual([]);
  });

  it("finds a topic page without its CollectionPage or its shows", () => {
    expect(checkKind(topicHtml().replace('"@type":"CollectionPage"', '"@type":"WebPage"'), `/topic/${mel.slug}`, "topic").findings.join("\n")).toMatch(/CollectionPage/);
    const noList = topicHtml().replace(/<ul class="hd-show-list[\s\S]*?<\/ul>/g, "");
    expect(checkKind(noList, `/topic/${mel.slug}`, "topic").findings.join("\n")).toMatch(/fewer than 3 shows/);
  });

  it("passes a real Tonight page, even with no database behind it", () => {
    expect(checkKind(tonightHtml(), `/tonight/${DAY}`, "tonight").findings).toEqual([]);
  });

  it("finds a Tonight page without its way into Live", () => {
    const html = tonightHtml().replace(/class="hd-tonight-tune[^"]*"/, 'class="x"');
    expect(checkKind(html, `/tonight/${DAY}`, "tonight").findings.join("\n")).toMatch(/Tune in/);
  });
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
  it("lists the app's routes, the Request Line, every show, guest and topic page, and the last two weeks of Tonight", () => {
    const urls = new Set(sitemap().map((e) => e.url));
    for (const p of ["", "/library", "/live", "/stats", "/topics", "/request-line"]) expect(urls.has(`${SITE_ORIGIN}${p}`), p).toBe(true);
    for (const s of catalog.shows) expect(urls.has(`${SITE_ORIGIN}/show/${s.slug}`), s.slug).toBe(true);
    for (const g of catalog.guests.keys()) expect(urls.has(`${SITE_ORIGIN}/guest/${g}`), g).toBe(true);
    for (const t of topics.topics) expect(urls.has(`${SITE_ORIGIN}/topic/${t.slug}`), t.slug).toBe(true);
    const nights = tonightSitemapDays(pacificDay(Date.now()));
    for (const d of nights) expect(urls.has(`${SITE_ORIGIN}/tonight/${d}`), d).toBe(true);
    // Never a moment: it is its show's page.
    expect([...urls].some((u) => u.includes("?t=") || u.includes("/moment/"))).toBe(false);
    expect(urls.size).toBe(6 + catalog.shows.length + catalog.guests.size + topics.topics.length + nights.length);
  });

  it("robots keeps crawlers out of the API, admin pages and /look, and names the sitemap", () => {
    const robots = readFileSync(path.join(ROOT, "public/robots.txt"), "utf8").split("\n").map((l) => l.trim());
    for (const rule of ["Disallow: /api/", "Disallow: /scanner", "Disallow: /search", "Disallow: /look"]) expect(robots).toContain(rule);
    expect(robots).toContain("Sitemap: https://highdesert.space/sitemap.xml");
    expect(robots.filter((l) => /^Disallow: \/(show|guest)/.test(l))).toEqual([]);
  });
});
