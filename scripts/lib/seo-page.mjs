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
 * Findings for a show or guest page's server HTML: empty means it passes.
 *
 * @param {Document} doc the HTML as the server sent it, parsed without running scripts
 * @param {{path: string, kind: "show" | "guest", base: string}} page
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

  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "";
  need(canonical.length > 0, "no canonical");
  if (canonical) need(sitePath(canonical, base) === path, `canonical ${canonical} is not this page`);

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
  if (kind === "show") need(types.includes("PodcastEpisode"), "no PodcastEpisode JSON-LD");
  if (kind === "guest") need(types.includes("CollectionPage"), "no CollectionPage JSON-LD");

  // The page is in the HTML, not drawn by JavaScript afterwards.
  const h1 = doc.querySelectorAll("h1");
  need(h1.length === 1 && (h1[0].textContent ?? "").trim().length > 0, "not exactly one non-empty <h1> in the server HTML");
  need(!!doc.querySelector(".hd-show-page"), "no .hd-show-page in the server HTML");
  if (kind === "show") {
    const slug = path.replace(/^\/show\//, "");
    need(!!doc.querySelector(`article[data-show-slug="${slug}"]`), "the show's article is not in the server HTML");
    const audio = doc.querySelector("audio[controls]");
    need(!!audio && audio.getAttribute("preload") === "none", "no <audio controls preload=none>");
    need(!!audio?.querySelector("source[src]"), "the audio has no source");
    need(!!doc.querySelector('a.hd-show-open[href^="/library?show="]'), "no Open in High Desert link");
  }
  if (kind === "guest") need(doc.querySelectorAll(".hd-show-list a[href^='/show/']").length >= 2, "a guest page lists fewer than 2 shows");
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
