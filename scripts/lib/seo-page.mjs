/**
 * What scripts/seo-check.mjs requires of one served page (docs/show-pages.md),
 * as a pure function over a parsed document, so the rules are tested
 * (scripts/__tests__/seo-page.test.ts) apart from the network.
 */

import { validateJsonLd } from "./jsonld-check.mjs";

export const SITE_ORIGIN = "https://highdesert.space";
const DASH = "—";

/** The path of an absolute or root-relative URL, or null for another site's. */
export function sitePath(href, base) {
  if (!href) return null;
  let url;
  try {
    url = new URL(href, base + "/");
  } catch {
    return null;
  }
  const origins = new Set([new URL(base + "/").origin, SITE_ORIGIN]);
  return origins.has(url.origin) ? url.pathname + url.search : null;
}

const meta = (doc, attr, name) => doc.querySelector(`meta[${attr}="${name}"]`)?.getAttribute("content")?.trim() ?? "";

/**
 * Findings for a show, guest, topic, Tonight or moment page's server HTML:
 * empty means it passes.
 *
 * A moment (`/show/<slug>?t=<s>`) is a show page whose canonical is the plain
 * show page, whose og:url is the moment's own URL, whose share card is the
 * moment's (`/show/<slug>/moment/<s>/...`), and whose player starts there.
 *
 * @param {Document} doc the HTML as the server sent it, parsed without running scripts
 * @param {{path: string, kind: "show" | "guest" | "topic" | "tonight" | "moment", base: string}} page
 * @returns {{findings: string[], links: string[], images: string[]}}
 *   links: every internal link on the page, as site paths, to be fetched;
 *   images: og:image and twitter:image, as site paths
 */
export function pageFindings(doc, { path, kind, base }) {
  const findings = [];
  const need = (ok, what) => {
    if (!ok) findings.push(what);
  };

  const title = doc.querySelector("title")?.textContent?.trim() ?? "";
  need(title.length > 0, "no <title>");
  need(meta(doc, "name", "description").length > 0, "no meta description");

  // A moment's canonical is its show's page: the moment is not a second page.
  const pagePath = path.split("?")[0];
  const moment = kind === "moment" ? Number(new URL(path, "https://x").searchParams.get("t")) : null;
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "";
  need(canonical.length > 0, "no canonical");
  if (canonical) need(sitePath(canonical, base) === pagePath, `canonical ${canonical} is not this page`);

  for (const p of ["og:title", "og:description", "og:image", "og:url"]) {
    need(meta(doc, "property", p).length > 0, `no ${p}`);
  }
  const ogUrl = meta(doc, "property", "og:url");
  if (ogUrl) need(sitePath(ogUrl, base) === path, `og:url ${ogUrl} is not this page`);
  need(meta(doc, "name", "twitter:card") === "summary_large_image", "twitter:card is not summary_large_image");

  // Structured data: every block parses and is valid schema.org.
  const types = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try {
      data = JSON.parse(s.textContent ?? "");
    } catch (e) {
      findings.push(`JSON-LD does not parse: ${String(e.message ?? e).slice(0, 80)}`);
      continue;
    }
    types.push(data?.["@type"]);
    for (const err of validateJsonLd(data)) findings.push(`JSON-LD: ${err}`);
  }
  need(types.includes("BreadcrumbList"), "no BreadcrumbList JSON-LD");
  if (kind === "show" || kind === "moment") need(types.includes("PodcastEpisode"), "no PodcastEpisode JSON-LD");
  if (kind === "guest" || kind === "topic" || kind === "tonight") need(types.includes("CollectionPage"), "no CollectionPage JSON-LD");

  // The page is in the HTML, not drawn by JavaScript afterwards.
  const h1 = doc.querySelectorAll("h1");
  need(h1.length === 1 && (h1[0].textContent ?? "").trim().length > 0, "not exactly one non-empty <h1> in the server HTML");
  need(!!doc.querySelector(".hd-show-page"), "no .hd-show-page in the server HTML");
  // A visitor from a search learns what the site is, and the ways in, on every page.
  const intro = doc.querySelector(".hd-show-intro");
  need(!!intro && /High Desert/.test(intro.textContent ?? ""), "no one-line intro to High Desert");
  need(!!intro?.querySelector('a[href="/live"]') && !!intro?.querySelector('a[href="/library"]'), "the intro has no way into Live and the Library");
  if (kind === "show" || kind === "moment") {
    const slug = pagePath.replace(/^\/show\//, "");
    need(!!doc.querySelector(`article[data-show-slug="${slug}"]`), "the show's article is not in the server HTML");
    const audio = doc.querySelector("audio[controls]");
    need(!!audio && audio.getAttribute("preload") === "none", "no <audio controls preload=none>");
    need(!!audio?.querySelector("source[src]"), "the audio has no source");
    need(!!doc.querySelector('a.hd-show-open[href^="/library?show="]'), "no Open in High Desert link");
    need(!!doc.querySelector(".hd-show-play"), "no one-tap Play button");
    // It needs JavaScript; without it a <noscript> rule hides it and the native controls remain.
    const noscript = [...doc.querySelectorAll("noscript")].map((n) => n.textContent ?? "").join("\n");
    need(/\.hd-show-play\{display:none/.test(noscript), "nothing hides the Play button without JavaScript");
  }
  if (kind === "moment") {
    const sources = [...doc.querySelectorAll("audio source[src]")].map((e) => e.getAttribute("src") ?? "");
    need(sources.length > 0 && sources.every((src) => src.endsWith(`#t=${moment}`)), `the player does not start at ${moment}s (#t=)`);
    need(doc.querySelector(".hd-show-moment")?.getAttribute("data-moment") === String(moment), "the page does not say where the moment starts");
    need(!!doc.querySelector(`a.hd-show-open[href*="t=${moment}"]`), "Open in High Desert does not carry the moment");
    const ogImage = meta(doc, "property", "og:image");
    need(ogImage.includes(`${pagePath}/moment/${moment}/opengraph-image`), "og:image is not the moment's card");
  }
  if (kind === "guest") need(doc.querySelectorAll(".hd-show-list a[href^='/show/']").length >= 2, "a guest page lists fewer than 2 shows");
  if (kind === "topic") {
    const slug = pagePath.replace(/^\/topic\//, "");
    need(!!doc.querySelector(`article[data-topic-slug="${slug}"]`), "the topic's article is not in the server HTML");
    need(doc.querySelectorAll(".hd-show-list a[href^='/show/']").length >= 3, "a topic page lists fewer than 3 shows");
  }
  if (kind === "tonight") {
    const day = pagePath.replace(/^\/tonight\//, "");
    need(!!doc.querySelector(`article[data-tonight-day="${day}"]`), "the day's article is not in the server HTML");
    need(!!doc.querySelector('a.hd-tonight-tune[href="/live"]'), "no Tune in link to /live");
    need(!!doc.querySelector(".hd-tonight-program") && !!doc.querySelector(".hd-tonight-dated"), "no program or on-this-date section");
  }
  // The boot screen must not cover the page, with or without JavaScript.
  const styles = [...doc.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
  need(/#app-loading\s*\{\s*display:\s*none\s*!important/.test(styles), "nothing hides the #app-loading boot screen");

  // The copy rule: no em dash in what a visitor reads.
  const text = [title, meta(doc, "name", "description"), meta(doc, "property", "og:title"), doc.querySelector(".hd-show-page")?.textContent ?? ""];
  need(!text.some((t) => t.includes(DASH)), "an em dash in the page's copy");

  const links = new Set();
  for (const a of doc.querySelectorAll("a[href]")) {
    const p = sitePath(a.getAttribute("href"), base);
    if (p) links.add(p);
  }
  const images = new Set();
  for (const name of ["og:image", "twitter:image"]) {
    const v = meta(doc, "property", name) || meta(doc, "name", name);
    const p = v ? sitePath(v, base) : null;
    if (v && !p) findings.push(`${name} ${v} is not on this site`);
    if (p) images.add(p);
  }
  return { findings, links: [...links], images: [...images] };
}

/** `n` items spread evenly through `items` (sorted first): the same sample every run. */
export function evenSample(items, n) {
  const sorted = [...items].sort();
  if (sorted.length <= n) return sorted;
  const out = [];
  for (let i = 0; i < n; i++) out.push(sorted[Math.floor((i * sorted.length) / n)]);
  return out;
}
