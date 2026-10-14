#!/usr/bin/env node
/**
 * Are the show pages what Google needs? Crawl a running server the way a
 * search engine first sees it: raw HTML, no JavaScript (docs/show-pages.md).
 *
 *   node scripts/seo-check.mjs                          # http://127.0.0.1:3000
 *   node scripts/seo-check.mjs https://highdesert.space
 *
 * Reads robots.txt and sitemap.xml, requires the sitemap to list every show in
 * the catalog (data/show-slugs.json against public/seed/library.json), every
 * topic (src/lib/topics/rules.ts, data/topic-slugs.json) and today's Tonight
 * page, then checks a fixed sample: SEO_CHECK_SAMPLE show pages spread evenly
 * through the slugs, plus edge cases (no guest, several guests, Dreamland, a
 * special, Midnight in the Desert, no summary); guest pages; topic pages (and
 * /topics); Tonight pages (today and the oldest in the sitemap); and shared
 * moments (`/show/<slug>?t=<s>`). Each must answer 200 and pass
 * scripts/lib/seo-page.mjs: title, description, canonical, Open Graph,
 * Twitter card, valid schema.org JSON-LD, the page in the server HTML, the
 * one-line intro and the ways into Live and the Library, nothing hiding it.
 * Every internal link on a checked page must answer 200, and its share images
 * must be 200 image/png, cacheable for a day or more. Also: /tonight sends
 * to today's page, a moment's own path sends to its `?t=` URL, a `t` that is
 * not whole seconds is the plain show page, and a moment is never cached by a
 * shared cache while the plain show page is.
 *
 * Exits non-zero on any finding.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { pageFindings, evenSample, sitePath } from "./lib/seo-page.mjs";
import { shownGuest } from "../src/lib/library/guest.ts";
import { deriveTopics } from "../src/lib/topics/rules.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = (process.argv[2] ?? process.env.SEO_CHECK_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const SAMPLE = Number(process.env.SEO_CHECK_SAMPLE ?? 25);
const GUEST_SAMPLE = Number(process.env.SEO_CHECK_GUEST_SAMPLE ?? 4);
const TOPIC_SAMPLE = Number(process.env.SEO_CHECK_TOPIC_SAMPLE ?? 6);
// A browser's, not a crawler's: Next sends crawlers blocking metadata, and a
// page that only works for them is a page that breaks for link previews.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 hd-seo-check";

const findings = [];
const find = (where, what) => findings.push({ where, what });

async function get(p, { redirect = "follow" } = {}) {
  const res = await fetch(BASE + p, { headers: { "user-agent": UA }, redirect });
  return res;
}

/** Runs `fn` over `items`, `limit` at a time. */
async function pool(items, limit, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    }),
  );
}

// --- what the catalog says should exist -------------------------------------
const rows = JSON.parse(readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8"));
const slugMap = JSON.parse(readFileSync(path.join(ROOT, "data/show-slugs.json"), "utf8"));
const catalogSlugs = rows.map((r) => slugMap[r.fileHash]).filter(Boolean);
const topicSlugMap = JSON.parse(readFileSync(path.join(ROOT, "data/topic-slugs.json"), "utf8"));
const topicSlugs = deriveTopics(rows.filter((r) => slugMap[r.fileHash])).map((t) => topicSlugMap[t.id]);
if (topicSlugs.some((s) => !s)) find("data/topic-slugs.json", "a topic has no slug: run node scripts/gen-topic-slugs.mjs");
if (catalogSlugs.length !== rows.length) find("data/show-slugs.json", `${rows.length - catalogSlugs.length} catalog show(s) have no slug`);

// --- robots.txt --------------------------------------------------------------
{
  const res = await get("/robots.txt");
  const body = res.ok ? await res.text() : "";
  if (!res.ok) find("/robots.txt", `HTTP ${res.status}`);
  for (const rule of ["Disallow: /api/", "Disallow: /scanner", "Disallow: /search", "Disallow: /look"]) {
    if (!body.split("\n").some((l) => l.trim() === rule)) find("/robots.txt", `missing "${rule}"`);
  }
  if (!/^Sitemap: https:\/\/highdesert\.space\/sitemap\.xml$/m.test(body)) find("/robots.txt", "no Sitemap line");
  if (/^Disallow: \/(show|guest)\b/m.test(body) || /^Disallow: \/\s*$/m.test(body)) find("/robots.txt", "show or guest pages are disallowed");
}

// --- sitemap.xml -------------------------------------------------------------
const sitemapPaths = new Set();
{
  const res = await get("/sitemap.xml");
  if (!res.ok) find("/sitemap.xml", `HTTP ${res.status}`);
  const xml = res.ok ? await res.text() : "";
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const p = sitePath(m[1].trim(), BASE);
    if (p) sitemapPaths.add(p);
    else find("/sitemap.xml", `a <loc> off this site: ${m[1]}`);
  }
  for (const p of ["/", "/library", "/live", "/stats"]) {
    if (!sitemapPaths.has(p)) find("/sitemap.xml", `missing ${p}`);
  }
  const missing = catalogSlugs.filter((s) => !sitemapPaths.has(`/show/${s}`));
  if (missing.length) find("/sitemap.xml", `${missing.length} show page(s) missing, e.g. /show/${missing[0]}`);
  const missingTopics = topicSlugs.filter((s) => s && !sitemapPaths.has(`/topic/${s}`));
  if (missingTopics.length) find("/sitemap.xml", `${missingTopics.length} topic page(s) missing, e.g. /topic/${missingTopics[0]}`);
  if (!sitemapPaths.has("/topics")) find("/sitemap.xml", "missing /topics");
  if (!sitemapPaths.has("/request-line")) find("/sitemap.xml", "missing /request-line");
}
const sitemapShows = [...sitemapPaths].filter((p) => p.startsWith("/show/")).map((p) => p.slice(6));
const sitemapGuests = [...sitemapPaths].filter((p) => p.startsWith("/guest/"));
const sitemapTopics = [...sitemapPaths].filter((p) => p.startsWith("/topic/"));
const sitemapNights = [...sitemapPaths].filter((p) => /^\/tonight\/\d{4}-\d{2}-\d{2}$/.test(p)).sort();

// --- /tonight is today's page ---------------------------------------------------
let tonightToday = null;
{
  const res = await get("/tonight", { redirect: "manual" });
  const to = sitePath(res.headers.get("location") ?? "", BASE);
  if (res.status !== 307 || !to || !/^\/tonight\/\d{4}-\d{2}-\d{2}$/.test(to)) {
    find("/tonight", `expected 307 to /tonight/<today>, got ${res.status} ${to}`);
  } else {
    tonightToday = to;
    if (!sitemapPaths.has(to)) find("/sitemap.xml", `today's Tonight page ${to} is not listed`);
    if (/max-age=[1-9]|s-maxage/.test(res.headers.get("cache-control") ?? "")) find("/tonight", "the redirect to today is cacheable");
  }
}

// --- the sample --------------------------------------------------------------
const bySlug = new Map(rows.filter((r) => slugMap[r.fileHash]).map((r) => [slugMap[r.fileHash], r]));
const firstWhere = (pred) => [...bySlug.keys()].sort().find((s) => pred(bySlug.get(s)));
const edges = {
  "no guest": firstWhere((r) => !shownGuest(r)),
  "several guests": firstWhere((r) => / and |, /.test(shownGuest(r) ?? "") && !/\d/.test(r.guestName)),
  dreamland: firstWhere((r) => r.showType === "dreamland"),
  special: firstWhere((r) => /^Special - /.test(r.title ?? "")),
  "midnight in the desert": firstWhere((r) => /^Midnight in the Desert - /.test(r.title ?? "")),
  "no summary": firstWhere((r) => !r.aiSummary),
  "no duration": firstWhere((r) => !r.duration),
};
for (const [label, slug] of Object.entries(edges)) if (!slug) find("sample", `no catalog show for the edge case "${label}"`);
const showSample = [...new Set([...evenSample(sitemapShows, SAMPLE), ...Object.values(edges).filter(Boolean)])];
const guestSample = evenSample(sitemapGuests, GUEST_SAMPLE);
if (!guestSample.length) find("sample", "the sitemap lists no guest pages");

const topicSample = [...new Set([...evenSample(sitemapTopics, TOPIC_SAMPLE), "/topic/mels-hole"])];
if (!sitemapTopics.length) find("sample", "the sitemap lists no topic pages");
const nightSample = [...new Set([tonightToday, sitemapNights[0]].filter(Boolean))];

// Moments: one inside a sampled show, and the edge of one that is past the end.
const momentShow = showSample.find((s) => (bySlug.get(s)?.duration ?? 0) > 600);
const momentPaths = momentShow ? [`/show/${momentShow}?t=${Math.floor(bySlug.get(momentShow).duration / 2)}`] : [];
if (!momentShow) find("sample", "no sampled show is long enough for a moment");

const pages = [
  ...showSample.map((slug) => ({ path: `/show/${slug}`, kind: "show" })),
  ...guestSample.map((p) => ({ path: p, kind: "guest" })),
  ...topicSample.map((p) => ({ path: p, kind: "topic" })),
  ...nightSample.map((p) => ({ path: p, kind: "tonight" })),
  ...momentPaths.map((p) => ({ path: p, kind: "moment" })),
  { path: "/request-line", kind: "request-line" },
];
const links = new Map(); // site path → first page that links to it
const images = new Map();

await pool(pages, 4, async (page) => {
  let res;
  try {
    res = await get(page.path);
  } catch (e) {
    find(page.path, `fetch failed: ${e.message}`);
    return;
  }
  if (res.status !== 200) {
    find(page.path, `HTTP ${res.status}`);
    return;
  }
  const html = await res.text();
  // Parsed, never run: this is the page a crawler without JavaScript reads.
  const doc = new JSDOM(html).window.document;
  const result = pageFindings(doc, { ...page, base: BASE });
  for (const f of result.findings) find(page.path, f);
  for (const l of result.links) if (!links.has(l)) links.set(l, page.path);
  for (const i of result.images) if (!images.has(i)) images.set(i, page.path);
  console.log(`  ${result.findings.length ? "FAIL" : "ok  "} ${page.path}`);
});

// --- every internal link, every share image -----------------------------------
await pool([...links.keys()], 6, async (p) => {
  try {
    const res = await get(p);
    if (res.status !== 200) find(links.get(p), `links to ${p}, which answers ${res.status}`);
    await res.arrayBuffer();
  } catch (e) {
    find(links.get(p), `links to ${p}, which failed: ${e.message}`);
  }
});
await pool([...images.keys()], 3, async (p) => {
  try {
    const res = await get(p);
    const type = res.headers.get("content-type") ?? "";
    const body = new Uint8Array(await res.arrayBuffer());
    const png = body.length > 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
    if (res.status !== 200 || !type.startsWith("image/png") || !png) {
      find(images.get(p), `share image ${p}: HTTP ${res.status}, ${type || "no type"}${png ? "" : ", not a PNG"}`);
    }
    // Drawn per request, so clients must be allowed to keep it (CARD_CACHE_CONTROL).
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 0);
    if (res.status === 200 && maxAge < 86_400) find(images.get(p), `share image ${p}: cache-control "${res.headers.get("cache-control")}" keeps it under a day`);
  } catch (e) {
    find(images.get(p), `share image ${p} failed: ${e.message}`);
  }
});

// --- the library's way in, and a slug that is not a show ----------------------
{
  const row = bySlug.get(showSample[0]);
  const key = `${row.archiveIdentifier}--${row.fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)}`;
  const res = await get(`/show/key/${key}`, { redirect: "manual" });
  const to = res.headers.get("location") ?? "";
  if (res.status !== 308 || sitePath(to, BASE) !== `/show/${showSample[0]}`) {
    find(`/show/key/${key}`, `expected 308 to /show/${showSample[0]}, got ${res.status} ${to}`);
  }
  const bogus = await get("/show/1900-01-01-not-a-show");
  if (bogus.status !== 404) find("/show/1900-01-01-not-a-show", `expected 404, got ${bogus.status}`);
  for (const p of ["/topic/not-a-topic", "/tonight/1999-01-01", "/tonight/2026-02-30"]) {
    const res = await get(p);
    if (res.status !== 404) find(p, `expected 404, got ${res.status}`);
  }
}

// --- moments: one address each, never in a shared cache; any other t is the show ----
if (momentShow) {
  const t = Math.floor(bySlug.get(momentShow).duration / 2);
  const direct = await get(`/show/${momentShow}/moment/${t}`, { redirect: "manual" });
  const to = sitePath(direct.headers.get("location") ?? "", BASE);
  if (direct.status !== 308 || to !== `/show/${momentShow}?t=${t}`) find(`/show/${momentShow}/moment/${t}`, `expected 308 to ?t=${t}, got ${direct.status} ${to}`);

  const m = await get(`/show/${momentShow}?t=${t}`);
  const mc = m.headers.get("cache-control") ?? "";
  if (!/no-store|private/.test(mc)) find(`/show/${momentShow}?t=${t}`, `a moment is cacheable by a shared cache: "${mc}"`);
  await m.arrayBuffer();

  const plain = await get(`/show/${momentShow}`);
  const pc = plain.headers.get("cache-control") ?? "";
  if (!/s-maxage=\d+/.test(pc)) find(`/show/${momentShow}`, `the plain show page is not static: "${pc}"`);
  await plain.arrayBuffer();

  for (const q of ["?t=1h", `?t=${10 ** 6}`, `?t=${Math.ceil(bySlug.get(momentShow).duration) + 5}`]) {
    const res = await get(`/show/${momentShow}${q}`);
    const html = res.ok ? await res.text() : "";
    const doc = new JSDOM(html).window.document;
    if (res.status !== 200 || doc.querySelector(".hd-show-moment")) find(`/show/${momentShow}${q}`, `expected the plain show page, got ${res.status}${doc.querySelector(".hd-show-moment") ? " with a moment" : ""}`);
  }
}

if (findings.length) {
  console.log(`\n[seo-check] ${findings.length} finding(s) on ${BASE}\n`);
  for (const f of findings) console.log(`  ${f.where}  ${f.what}`);
  process.exit(1);
}
console.log(
  `\n[seo-check] ${BASE}: sitemap lists ${sitemapShows.length} shows, ${sitemapGuests.length} guests, ${sitemapTopics.length} topics and ${sitemapNights.length} nights; ` +
    `${pages.length} pages, ${links.size} internal links and ${images.size} share images checked, no findings.`,
);
