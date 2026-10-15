import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog } from "@/lib/shows/catalog";
import { pacificDayBounds, type DayProgram, type ProgramSlot } from "@/lib/live/schedule";
import {
  FIRST_TONIGHT_DAY,
  FIRST_STATION_DAY,
  onThisDate,
  tonightCard,
  tonightDate,
  tonightDayInRange,
  tonightPage,
  tonightSitemapDays,
} from "@/lib/tonight/tonight";
import { tonightData } from "@/services/live/tonight";
import { ShowShell } from "@/components/shows/ShowShell";
import { TonightView } from "@/components/tonight/TonightView";
import { TopicView, TopicsIndex } from "@/components/topics/TopicView";
import { buildTopicCatalog } from "@/lib/topics/catalog";
import { readTopicSlugs } from "@/lib/topics/load";
import { breadcrumbJsonLd, tonightCrumbs, tonightJsonLd } from "@/lib/shows/jsonld";
import { validateJsonLd } from "../../../../scripts/lib/jsonld-check.mjs";

/**
 * Tonight on High Desert and the topic pages, rendered (docs/show-pages.md):
 * which days have a page, what a day lists, how it degrades without a
 * database, and that every page's HTML is complete: links that resolve, valid
 * structured data, no em dash.
 */

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const { rows, slugs } = readCatalogFiles(ROOT);
const catalog = buildShowCatalog(rows, slugs);
const topics = buildTopicCatalog(catalog, readTopicSlugs());
const DAY = "2026-10-12";
const DASH = "—";

/** A program for DAY: two of the date's shows and one favorite, end to end. */
function program(day = DAY): DayProgram {
  const { start, end } = pacificDayBounds(day);
  const picks = [...onThisDate(day, catalog).slice(0, 2), catalog.bySlug.get("1992-12-12-area-51-john-lear-bob-lazar")!];
  let t = start;
  const slotsList: ProgramSlot[] = picks.map((s, i) => {
    const slot = {
      fileHash: s.row.fileHash,
      episodeId: null,
      title: s.row.title ?? "",
      airDate: s.row.airDate ?? null,
      guestName: s.row.guestName ?? null,
      showType: null,
      duration: 3600,
      sourceUrl: null,
      kind: i < 2 ? "on-this-date" : "fan-favorite",
      start: t,
      end: t + 3_600_000,
    } as ProgramSlot;
    t += 3_608_000;
    return slot;
  });
  return { day, start, end, slots: slotsList.reverse(), ranking: [] };
}

function doc(html: string): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
}

function resolves(href: string): boolean {
  const p = href.split("?")[0];
  if (p.startsWith("/show/")) return catalog.bySlug.has(p.slice(6));
  if (p.startsWith("/guest/")) return catalog.guests.has(p.slice(7));
  if (p.startsWith("/topic/")) return topics.bySlug.has(p.slice(7));
  if (p.startsWith("/tonight/")) return tonightDayInRange(p.slice(9), DAY);
  return ["/", "/library", "/live", "/stats", "/tonight", "/topics", "/request-line"].includes(p);
}

function checkPage(d: Document, label: string) {
  for (const a of d.querySelectorAll("a[href]")) expect(resolves(a.getAttribute("href")!), `${label}: ${a.getAttribute("href")}`).toBe(true);
  for (const s of d.querySelectorAll('script[type="application/ld+json"]')) {
    expect(validateJsonLd(JSON.parse(s.textContent!)), label).toEqual([]);
  }
  expect(d.body.textContent!.includes(DASH), label).toBe(false);
}

describe("which days have a page", () => {
  it("a real calendar day from the station's first to tomorrow", () => {
    expect(tonightDayInRange(DAY, DAY)).toBe(true);
    expect(tonightDayInRange("2026-10-13", DAY)).toBe(true);
    expect(tonightDayInRange("2026-10-14", DAY)).toBe(false);
    expect(tonightDayInRange(FIRST_TONIGHT_DAY, DAY)).toBe(true);
    expect(tonightDayInRange("2026-08-31", DAY)).toBe(false);
    for (const bad of ["2026-02-30", "2026-9-1", "today", "2026-10-12x"]) expect(tonightDayInRange(bad, DAY), bad).toBe(false);
  });

  it("the sitemap lists every station day, today first, back to the first and never before it", () => {
    const days = tonightSitemapDays(DAY);
    expect(days[0]).toBe(DAY);
    expect(days[days.length - 1]).toBe(FIRST_STATION_DAY);
    // 2026-09-11 to 2026-10-12, no gaps (it used to stop at 14).
    expect(days).toHaveLength(32);
    for (let i = 1; i < days.length; i++) expect(days[i] < days[i - 1]).toBe(true);
    expect(new Set(days).size).toBe(days.length);
    expect(tonightSitemapDays("2026-09-12")).toEqual(["2026-09-12", "2026-09-11"]);
    // Control: the day before the first is a 404 and is never listed.
    expect(tonightSitemapDays("2026-09-10")).toEqual([]);
  });

  it("names the day in words", () => {
    expect(tonightDate(DAY)).toBe("Monday, October 12, 2026");
  });
});

describe("what a day lists", () => {
  it("every broadcast of the date, any year, oldest first", () => {
    const dated = onThisDate(DAY, catalog);
    expect(dated.length).toBeGreaterThan(0);
    for (const s of dated) expect(s.row.airDate!.slice(5)).toBe("10-12");
    const dates = dated.map((s) => s.row.airDate);
    expect(dates).toEqual([...dates].sort());
  });

  it("the program in air order, each with why to hear it; the structured list holds each show once", () => {
    const page = tonightPage(DAY, program(), catalog);
    expect(page.lineup.map((e) => e.start)).toEqual([...page.lineup.map((e) => e.start)].sort((a, b) => a - b));
    expect(page.lineup.every((e) => e.show && e.why)).toBe(true);
    const slugsListed = page.listed.map((s) => s.slug);
    expect(new Set(slugsListed).size).toBe(slugsListed.length);
    expect(slugsListed.slice(0, 3)).toEqual(page.lineup.map((e) => e.show!.slug));
    expect(page.description.length).toBeLessThanOrEqual(160);
    expect(page.description).not.toContain(DASH);
    expect(validateJsonLd(tonightJsonLd(DAY, page.title, page.description, page.listed))).toEqual([]);
    expect(validateJsonLd(breadcrumbJsonLd(tonightCrumbs(DAY, tonightDate(DAY))))).toEqual([]);
  });

  it("a card that counts the date's broadcasts, or names the station when there are none", () => {
    const dated = onThisDate(DAY, catalog);
    expect(tonightCard(DAY, dated, []).title).toBe(`${dated.length} ${dated.length === 1 ? "broadcast" : "broadcasts"} from October 12`);
    expect(tonightCard(DAY, [], []).title).toBe("The station on October 12");
  });
});

describe("tonightData (read-only, but for today's freeze)", () => {
  const now = () => Date.parse("2026-10-12T20:00:00Z");

  it("without a database: unavailable, and nothing is read", async () => {
    const readDays = vi.fn();
    expect(await tonightData(DAY, { hasDatabase: () => false, readDays })).toEqual({ available: false, program: null, prev: false, next: false });
    expect(readDays).not.toHaveBeenCalled();
  });

  it("reads a past day as frozen, and never freezes it", async () => {
    const p = program("2026-10-01");
    const freeze = vi.fn();
    const r = await tonightData("2026-10-01", {
      now,
      hasDatabase: () => true,
      freeze,
      readDays: async () => new Map([["2026-09-30", p], ["2026-10-01", p]]),
    });
    expect(r).toEqual({ available: true, program: p, prev: true, next: false });
    expect(freeze).not.toHaveBeenCalled();
  });

  it("freezes today if nobody has yet; a future day it never freezes", async () => {
    const p = program();
    const freeze = vi.fn(async () => p);
    const r = await tonightData(DAY, { now, hasDatabase: () => true, freeze, readDays: async () => new Map() });
    expect(r.program).toBe(p);
    expect(r.prev).toBe(true);
    expect(freeze).toHaveBeenCalledWith(DAY);
    freeze.mockClear();
    const tomorrow = await tonightData("2026-10-13", { now, hasDatabase: () => true, freeze, readDays: async () => new Map() });
    expect(tomorrow.program).toBeNull();
    expect(freeze).not.toHaveBeenCalled();
  });

  it("applies the Request Line's locked night: the winner at 10 PM, named on the page", async () => {
    const p = program();
    const winner = catalog.bySlug.get("1992-12-12-area-51-john-lear-bob-lazar")!.row;
    const byHash = new Map([[winner.fileHash, { ...winner, duration: 3600 }]]);
    const r = await tonightData(DAY, {
      now,
      hasDatabase: () => true,
      readDays: async () => new Map([[DAY, p]]),
      loadNight: async (day) => ({ day, fileHash: winner.fileHash, by: "Night Owl", place: "Pahrump", votes: 4 }),
      byHash: async () => byHash as never,
    });
    const req = r.program!.slots.find((s) => s.kind === "request")!;
    expect(req.fileHash).toBe(winner.fileHash);
    expect(req.start).toBe(pacificDayBounds(DAY).end - 2 * 3_600_000);
    expect(req.request).toMatchObject({ by: "Night Owl", place: "Pahrump", votes: 4 });
    const page = tonightPage(DAY, r.program, catalog);
    const html = renderToStaticMarkup(
      createElement(TonightView, { day: DAY, today: DAY, page, available: true, prev: true, next: false }),
    );
    expect(html).toContain("Listener request");
    expect(doc(html).querySelector('[data-testid="tonight-requested-by"]')!.textContent).toBe("from Night Owl, calling from Pahrump");
    expect(html).not.toContain(DASH);
  });

  it("control: an empty night (nobody nominated) leaves the program as frozen", async () => {
    const p = program();
    const r = await tonightData(DAY, {
      now,
      hasDatabase: () => true,
      readDays: async () => new Map([[DAY, p]]),
      loadNight: async (day) => ({ day, fileHash: null, by: null, place: null, votes: 0 }),
    });
    expect(r.program).toBe(p);
  });

  it("a database that fails reads as unavailable, not as an error page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await tonightData(DAY, { now, hasDatabase: () => true, readDays: async () => Promise.reject(new Error("down")) });
    expect(r.available).toBe(false);
  });
});

describe("the Tonight page, rendered", () => {
  const render = (props: { available: boolean; program: DayProgram | null; prev?: boolean; next?: boolean }) =>
    doc(
      renderToStaticMarkup(
        createElement(
          ShowShell,
          null,
          createElement(TonightView, {
            day: DAY,
            today: DAY,
            page: tonightPage(DAY, props.program, catalog),
            available: props.available,
            prev: props.prev ?? true,
            next: props.next ?? false,
          }),
        ),
      ),
    );

  it("leads with a big Tune in, then the program with Pacific times, then the date's broadcasts", () => {
    const d = render({ available: true, program: program() });
    const tune = d.querySelector("a.hd-tonight-tune")!;
    expect(tune.getAttribute("href")).toBe("/live");
    expect(tune.textContent).toContain("Tune in");
    const slotsShown = d.querySelectorAll(".hd-tonight-slot");
    expect(slotsShown).toHaveLength(3);
    expect(slotsShown[0].textContent).toMatch(/12:00 AM PT/);
    expect(d.querySelectorAll(".hd-tonight-why")).toHaveLength(3);
    expect(d.querySelectorAll(".hd-tonight-dated li").length).toBe(onThisDate(DAY, catalog).length);
    expect(d.querySelector('.hd-tonight-days a[href="/tonight/2026-10-11"]')).not.toBeNull();
    checkPage(d, "tonight");
  });

  it("without a database, still lists the date's broadcasts and says why the program is missing", () => {
    const d = render({ available: false, program: null });
    expect(d.querySelector(".hd-tonight-none")?.textContent).toContain("cannot be read right now");
    expect(d.querySelectorAll(".hd-tonight-dated li").length).toBeGreaterThan(0);
    checkPage(d, "tonight, no database");
  });
});

describe("topic pages, rendered", () => {
  it("every topic: intro, a first show to press, every show, related topics, valid JSON-LD, links that resolve", () => {
    for (const t of topics.topics) {
      const d = doc(renderToStaticMarkup(createElement(ShowShell, null, createElement(TopicView, { topic: t, catalog: topics }))));
      expect(d.querySelector("h1")?.textContent, t.slug).toBe(t.name);
      expect(d.querySelector(".hd-topic-intro")?.textContent, t.slug).toBe(t.intro);
      expect(d.querySelector("a.hd-topic-first")?.getAttribute("href"), t.slug).toMatch(/^\/show\//);
      expect(d.querySelectorAll("#hd-topic-shows + ul li").length, t.slug).toBe(t.shows.length);
      const types = [...d.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!)["@type"]);
      expect(types, t.slug).toEqual(["CollectionPage", "BreadcrumbList"]);
      checkPage(d, t.slug);
    }
  });

  it("Mel's Hole leads with its notable shows and links its related topics", () => {
    const t = topics.bySlug.get("mels-hole")!;
    const d = doc(renderToStaticMarkup(createElement(TopicView, { topic: t, catalog: topics })));
    expect(d.querySelectorAll(".hd-topic-start li").length).toBeGreaterThan(0);
    expect(d.querySelectorAll(".hd-topic-related a").length).toBeGreaterThan(0);
  });

  it("the index lists every topic once", () => {
    const d = doc(renderToStaticMarkup(createElement(ShowShell, null, createElement(TopicsIndex, { catalog: topics }))));
    const hrefs = [...d.querySelectorAll(".hd-topic-links a")].map((a) => a.getAttribute("href"));
    expect(hrefs.sort()).toEqual(topics.topics.map((t) => `/topic/${t.slug}`).sort());
    checkPage(d, "topics");
  });
});
