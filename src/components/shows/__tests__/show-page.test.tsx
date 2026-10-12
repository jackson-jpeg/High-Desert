import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog } from "@/lib/shows/catalog";
import { ShowShell, NO_BOOT_CSS } from "@/components/shows/ShowShell";
import { ShowView } from "@/components/shows/ShowView";
import { parseLibraryIntent } from "@/lib/library/intents";
import { communityKey } from "@/lib/utils/community-key";
import { BOOT_SCRIPT } from "@/app/boot-script";
import type { Show } from "@/lib/shows/describe";
import { buildTopicCatalog } from "@/lib/topics/catalog";
import { readTopicSlugs } from "@/lib/topics/load";

/**
 * A show page's markup, as the server sends it (docs/show-pages.md): what a
 * crawler and a browser without JavaScript get. scripts/seo-check.mjs checks
 * the same things on a running server; this holds them for every show.
 */

const { rows, slugs } = readCatalogFiles();
const catalog = buildShowCatalog(rows, slugs);
const area51 = catalog.bySlug.get("1992-12-12-area-51-john-lear-bob-lazar")!;
const topics = buildTopicCatalog(catalog, readTopicSlugs());

function render(show: Show, moment: number | null = null): Document {
  const html = renderToStaticMarkup(
    createElement(ShowShell, null, createElement(ShowView, { show, catalog, topics: topics.byShow.get(show.slug) ?? [], moment })),
  );
  return new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`, "text/html");
}

/** Where an internal link goes, if it is somewhere this site has. */
function resolves(href: string): boolean {
  const url = new URL(href, "https://highdesert.space");
  if (url.origin !== "https://highdesert.space") return true;
  const p = url.pathname;
  if (p.startsWith("/show/")) return catalog.bySlug.has(p.slice(6));
  if (p.startsWith("/guest/")) return catalog.guests.has(p.slice(7));
  if (p.startsWith("/topic/")) return topics.bySlug.has(p.slice(7));
  if (p === "/library" && url.search) {
    const intent = parseLibraryIntent(url.searchParams);
    return Object.keys(intent).length > 0;
  }
  return ["/", "/library", "/live", "/stats", "/tonight", "/topics"].includes(p);
}

describe("a show page's server HTML", () => {
  it("has one h1 naming the show and its guests, and the facts", () => {
    const doc = render(area51);
    const h1 = [...doc.querySelectorAll("h1")];
    expect(h1).toHaveLength(1);
    expect(h1[0].textContent).toBe("Area 51 with John Lear and Bob Lazar");
    expect(doc.querySelector(".hd-show-series")?.textContent).toBe("Coast to Coast AM · December 12, 1992");
    const meta = doc.querySelector(".hd-show-meta")?.textContent ?? "";
    for (const fact of ["December 12, 1992", "Coast to Coast AM with Art Bell", "John Lear and Bob Lazar", "UFOs & Aliens", "2 h 10 min"]) {
      expect(meta).toContain(fact);
    }
    expect(doc.querySelector(".hd-show-summary")?.textContent).toContain("Bob Lazar discuss Area 51");
  });

  it("plays without JavaScript: native controls, nothing fetched until asked", () => {
    const audio = render(area51).querySelector("audio")!;
    expect(audio.hasAttribute("controls")).toBe(true);
    expect(audio.getAttribute("preload")).toBe("none");
    const sources = [...audio.querySelectorAll("source")].map((s) => s.getAttribute("src"));
    expect(sources[0]).toBe(area51.row.sourceUrl);
    expect(sources[1]).toMatch(/^\/mirror\/archive%3A/);
  });

  it("opens the show in the library through the show intent", () => {
    const open = render(area51).querySelector("a.hd-show-open")!;
    expect(open.textContent).toBe("Open in High Desert");
    const url = new URL(open.getAttribute("href")!, "https://highdesert.space");
    expect(url.pathname).toBe("/library");
    expect(parseLibraryIntent(url.searchParams)).toEqual({ show: communityKey(area51.row) });
  });

  it("is not hidden behind the app's boot screen", () => {
    const doc = render(area51);
    const css = [...doc.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toContain(NO_BOOT_CSS);
    // The rule names the boot screen the root layout actually draws.
    expect(BOOT_SCRIPT).toContain("getElementById('app-loading')");
  });

  it("says what High Desert is and offers the station and the Library, before anything else", () => {
    const doc = render(area51);
    const intro = doc.querySelector(".hd-show-intro")!;
    expect(intro.textContent).toContain("Art Bell's late night radio free");
    expect([...intro.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Listen to the station now", "/live"],
      ["Browse the Library", "/library"],
    ]);
    // The intro precedes the show itself in the document.
    expect(intro.compareDocumentPosition(doc.querySelector("h1")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has a one-tap Play on the page's own player, hidden without JavaScript", () => {
    const doc = render(area51);
    const play = doc.querySelector("button.hd-show-play")!;
    expect(play.textContent).toContain("Play the show");
    expect(doc.querySelector("audio")!.id).toBe("hd-show-audio");
    expect(doc.querySelector("noscript")!.innerHTML).toContain(".hd-show-play{display:none!important}");
    // Above the facts: the first thing under the title is the player.
    expect(play.compareDocumentPosition(doc.querySelector(".hd-show-meta")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("links the show's topics, most specific first, and its category to the category's page", () => {
    const doc = render(area51);
    const links = [...doc.querySelectorAll(".hd-show-topics a")].map((a) => a.getAttribute("href"));
    expect(links[0]).toBe("/topic/area-51");
    expect(doc.querySelector(".hd-show-meta a.hd-show-category-link")?.getAttribute("href")).toBe("/topic/ufos-aliens");
  });

  it("a shared moment: starts the player there, says so, and carries it into the app", () => {
    const doc = render(area51, 5025);
    for (const s of doc.querySelectorAll("audio source")) expect(s.getAttribute("src")).toMatch(/#t=5025$/);
    expect(doc.querySelector(".hd-show-moment")?.textContent).toContain("1:23:45");
    expect(doc.querySelector("button.hd-show-play")?.textContent).toContain("Play from 1:23:45");
    const open = new URL(doc.querySelector("a.hd-show-open")!.getAttribute("href")!, "https://highdesert.space");
    expect(parseLibraryIntent(open.searchParams)).toEqual({ show: communityKey(area51.row), t: 5025 });
    // The plain page has none of it.
    const plain = render(area51);
    expect(plain.querySelector(".hd-show-moment")).toBeNull();
    for (const s of plain.querySelectorAll("audio source")) expect(s.getAttribute("src")).not.toContain("#t=");
  });

  it("carries the hd-show- class hooks the preview looks restyle", () => {
    const doc = render(area51);
    for (const c of ["hd-show-page", "hd-show-header", "hd-show-title", "hd-show-meta", "hd-show-player", "hd-show-related", "hd-show-open"]) {
      expect(doc.querySelector(`.${c}`), c).not.toBeNull();
    }
  });

  it("for every show: valid JSON-LD blocks, one h1, every internal link resolves, no em dash", () => {
    for (const show of catalog.shows) {
      const doc = render(show);
      expect(doc.querySelectorAll("h1"), show.slug).toHaveLength(1);
      const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!)["@type"]);
      expect(ld, show.slug).toEqual(["PodcastEpisode", "BreadcrumbList"]);
      for (const a of doc.querySelectorAll("a[href]")) {
        expect(resolves(a.getAttribute("href")!), `${show.slug} links to ${a.getAttribute("href")}`).toBe(true);
      }
      expect(doc.body.textContent, show.slug).not.toContain("—");
    }
  }, 60_000);
});
