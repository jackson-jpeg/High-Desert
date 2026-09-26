import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProgramGuide } from "../ProgramGuide";
import type { ProgramSlot } from "@/lib/live/schedule";

/**
 * On a phone the Studio opened scrolled down to the log's ON AIR row, with the
 * clock, the live count and Now playing above the top of the screen: the guide
 * called scrollIntoView, which scrolls every scrolling ancestor, and on a phone
 * the log's box grows to fit its rows, so the ancestor that moved was the page.
 * Found by e2e/live-qa.spec.ts "nothing in the studio is wider than the screen"
 * on CI at 6 PM Pacific, when the show on air sits far down the day's log.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 25, 7);
const slots: ProgramSlot[] = Array.from({ length: 8 }, (_, i) => ({
  fileHash: `archive:x:${i}.mp3`,
  episodeId: `e${i}`,
  title: `Show ${i}`,
  airDate: "1997-09-25",
  guestName: `Guest ${i}`,
  showType: "coast",
  duration: 3 * HOUR / 1000,
  sourceUrl: `https://archive.org/download/x/${i}.mp3`,
  kind: "on-this-date",
  start: T0 + i * 3 * HOUR,
  end: T0 + (i + 1) * 3 * HOUR,
}));
const NOW = slots[7].start + 60_000; // the last show of the day is on

const ROW = 40;
const HEADING = 30;

let root: Root;
let host: HTMLDivElement;
let box: HTMLDivElement;
let scrollIntoView: ReturnType<typeof vi.fn>;
let pageScroll: ReturnType<typeof vi.spyOn>;

/**
 * Lay the log out the way the browser would: the box at the top of the screen,
 * `viewport` px tall (its visible height), with a sticky heading and one 40 px
 * row per slot, positioned from the box's current scrollTop.
 */
function layout(viewport: number) {
  const content = HEADING + slots.length * ROW;
  Object.defineProperty(box, "clientHeight", { configurable: true, get: () => viewport });
  Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => Math.max(content, viewport) });
  box.getBoundingClientRect = () => new DOMRect(0, 0, 390, viewport);
  const heading = box.querySelector("h3") as HTMLElement;
  Object.defineProperty(heading, "offsetHeight", { configurable: true, get: () => HEADING });
  box.querySelectorAll("li").forEach((li, i) => {
    li.getBoundingClientRect = () => new DOMRect(0, HEADING + i * ROW - box.scrollTop, 390, ROW);
  });
}

function mount(viewport: number) {
  box = document.createElement("div");
  host.appendChild(box);
  root = createRoot(box);
  // Layout has to exist before the guide's mount effect reads it, so render
  // the rows first with the on-air slot absent, lay out, then bring it on.
  act(() => root.render(createElement("div", null, createElement("h3", null, "Tonight's log"), createElement(ProgramGuide, { slots, now: slots[0].start - 1 }))));
  // The guide is the ProgramGuide's <ol>; its parent is the scrolling box.
  box = box.firstElementChild as HTMLDivElement;
  layout(viewport);
  act(() => root.render(createElement("div", null, createElement("h3", null, "Tonight's log"), createElement(ProgramGuide, { slots, now: NOW }))));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  scrollIntoView = vi.fn();
  (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
  pageScroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  pageScroll.mockRestore();
});

describe("the log brings the show on air into view", () => {
  it("on a phone, where the log grows to fit its rows, nothing scrolls: not the log, not the page", () => {
    mount(10_000);
    expect(box.scrollTop).toBe(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(pageScroll).not.toHaveBeenCalled();
  });

  it("on desktop, where the log is a bounded box, it scrolls that box until the on-air row is in it", () => {
    mount(160);
    const onAir = box.querySelector<HTMLElement>('li[data-state="now"]')!;
    const r = onAir.getBoundingClientRect();
    expect(box.scrollTop).toBeGreaterThan(0);
    expect(r.top).toBeGreaterThanOrEqual(HEADING);
    expect(r.bottom).toBeLessThanOrEqual(160);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
