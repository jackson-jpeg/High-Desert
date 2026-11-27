import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CallSlip } from "@/components/shows/CallSlip";
import { Tally, TALLY_MAX } from "@/components/request-line/RequestLineList";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog, type Guest } from "@/lib/shows/catalog";
import { longDate } from "@/lib/shows/describe";
import { ShowView } from "@/components/shows/ShowView";
import { FlipClock, untilClose } from "@/components/request-line/FlipClock";
import { TopicsIndex, topicSpan } from "@/components/topics/TopicView";
import { buildTopicCatalog } from "@/lib/topics/catalog";
import { readTopicSlugs } from "@/lib/topics/load";

/**
 * Guests as late-night phone messages and the request board's tally marks
 * (docs/UI-PLAN.md, push 4).
 */

const src = path.resolve(import.meta.dirname, "../../..");
const globals = readFileSync(path.join(src, "app/globals.css"), "utf8");
const token = (name: string) => new RegExp(`--hd-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(globals)![1];
function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const { rows, slugs } = readCatalogFiles();
const catalog = buildShowCatalog(rows, slugs);
const guests = [...catalog.guests.values()];

describe("the call slip", () => {
  const guest = guests.find((g) => g.shows.length >= 3)!;

  it("types the guest's name as the page's one h1, from the catalog's own facts", () => {
    const html = renderToStaticMarkup(createElement(CallSlip, { guest, about: "UFOs & Aliens" }));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(`>${guest.name}</h1>`);
    expect(html).toContain(`data-call-slip-nights="${guest.shows.length}"`);
    expect(html).toContain(`${guest.shows.length} nights, ${longDate(guest.shows[0].row.airDate)} to ${longDate(guest.shows.at(-1)!.row.airDate)}`);
    expect(html).toContain("UFOs &amp; Aliens");
    expect(html).not.toContain("—");
  });

  it("ticks Called again only for a guest who came back", () => {
    const once: Guest = { ...guest, shows: guest.shows.slice(0, 1) };
    const box = (html: string, label: string) => new RegExp(`<li( data-checked="")?>${label}</li>`).exec(html)![1] !== undefined;
    expect(box(renderToStaticMarkup(createElement(CallSlip, { guest, about: null })), "Called again")).toBe(true);
    const single = renderToStaticMarkup(createElement(CallSlip, { guest: once, about: null }));
    expect(box(single, "Called again")).toBe(false);
    expect(single).toContain("One night");
    expect(single).not.toContain("data-call-slip-about");
  });

  it("is on every guest page, in place of the bare title", () => {
    const page = readFileSync(path.join(src, "app/[look]/guest/[slug]/page.tsx"), "utf8");
    expect(page).toMatch(/<CallSlip guest=\{guest\} about=\{topics\[0\]\?\.name \?\? null\} \/>/);
    expect(page).not.toMatch(/<h1/);
  });

  it("a show page carries its guest's slip, without a second h1, and links to their page", () => {
    const show = catalog.bySlug.get("1992-12-12-area-51-john-lear-bob-lazar")!;
    const html = renderToStaticMarkup(createElement(ShowView, { show, catalog }));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('data-call-slip=""');
    expect(html).toMatch(/<p class="hd-call-slip-name hd-show-title">(John Lear|Bob Lazar)<\/p>/);
    expect(html).toMatch(/href="\/guest\/[^"]+"[^>]*>Every show with /);
  });

  it("a show whose guest has no page carries no slip", () => {
    const lone = [...catalog.bySlug.values()].find((s) => !guests.some((g) => g.shows.includes(s)))!;
    expect(renderToStaticMarkup(createElement(ShowView, { show: lone, catalog }))).not.toContain("data-call-slip");
  });

  it("its ink and its printed red pass on the pink", () => {
    expect(contrast(token("slip-ink"), token("slip"))).toBeGreaterThanOrEqual(7);
    expect(contrast(token("slip-red"), token("slip"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the request board's tally", () => {
  const draw = (n: number) => renderToStaticMarkup(createElement(Tally, { n }));

  it("draws a gate per five votes and the strokes left", () => {
    const seven = draw(7);
    expect(seven.match(/hd-tally-five/g)).toHaveLength(1);
    expect(seven).toContain('style="width:8px"');
    expect(draw(10).match(/hd-tally-five/g)).toHaveLength(2);
    expect(draw(10)).not.toContain("hd-tally-rest");
    expect(draw(3)).not.toContain("hd-tally-five");
  });

  it("draws nothing for no votes, never more than the cap, and stays out of the accessibility tree", () => {
    expect(draw(0)).toBe("");
    expect(draw(400)).toContain(`data-tally="${TALLY_MAX}"`);
    expect(draw(4)).toContain('aria-hidden="true"');
  });
});

describe("topic cards", () => {
  const topics = buildTopicCatalog(catalog, readTopicSlugs());

  it("give a topic its years on the air and the era most of its shows are from", () => {
    const mel = topics.bySlug.get("mels-hole")!;
    const span = topicSpan(mel)!;
    const years = mel.shows.map((s) => Number(s.row.airDate!.slice(0, 4)));
    expect(span.from).toBe(Math.min(...years));
    expect(span.to).toBe(Math.max(...years));
    expect(span.era).not.toBeNull();
    expect(topicSpan({ shows: [] })).toBeNull();
  });

  it("/topics draws every topic as a card with its count and years", () => {
    const html = renderToStaticMarkup(createElement(TopicsIndex, { catalog: topics }));
    const cards = [...html.matchAll(/class="hd-topic-card hd-era-log/g)];
    expect(cards.length).toBe(topics.topics.length);
    const mel = topics.bySlug.get("mels-hole")!;
    const span = topicSpan(mel)!;
    expect(html).toContain(`${mel.shows.length} shows, ${span.from === span.to ? span.from : `${span.from} to ${span.to}`}`);
  });
});

describe("the request board's flip clock", () => {
  it("counts hours and minutes left, rounded up, and closes at the hour", () => {
    const close = Date.UTC(2026, 10, 28, 2, 0);
    expect(untilClose(close, close - (2 * 3600 + 5 * 60) * 1000)).toEqual({ h: 2, m: 5 });
    expect(untilClose(close, close - 30_000)).toEqual({ h: 0, m: 1 });
    expect(untilClose(close, close)).toBeNull();
    expect(untilClose(close, close + 1)).toBeNull();
  });

  it("is on the request board while voting is open, and the server draws blank cards", () => {
    const html = renderToStaticMarkup(createElement(FlipClock, { closesAt: Date.now() + 3_600_000 }));
    expect(html).toContain('role="timer"');
    expect(html.match(/class="hd-flip-card">-</g)).toHaveLength(4);
    const view = readFileSync(path.join(src, "components/request-line/RequestLineView.tsx"), "utf8");
    expect(view).toContain("{available ? <FlipClock closesAt={closes} /> : null}");
  });
});
