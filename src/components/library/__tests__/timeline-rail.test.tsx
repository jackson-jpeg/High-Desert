import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";

/**
 * The real TimelineView and rail, mounted: what the rail shows and what
 * clicking it does, measured on the DOM the listener gets
 * (docs/timeline-rail.md). Only the breakpoint and the community-stats fetch
 * are stubbed; neither is under test.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useMediaQuery: () => false,
}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

const { TimelineView } = await import("@/components/library/TimelineView");
const { NothingInProgress } = await import("@/components/library/LibraryListStates");
const { itemHeightFor, headerHeightFor } = await import("@/hooks/useTextScale");

const ROW = itemHeightFor(false, 1); // 34 on desktop at 1x
const HEAD = headerHeightFor(false, 1); // 26: every group has an inline header above its first row

/**
 * Top of row `i` in `rows()`, whose groups are ten rows each: `i` rows above
 * it, plus one header for its own group and each group before. Written out as
 * arithmetic, not by calling list-layout, so a layout bug cannot agree with it.
 */
const top = (i: number) => i * ROW + (Math.floor(i / 10) + 1) * HEAD;
/** Top of the header of the group starting at row `first`. */
const headerTop = (first: number) => top(first) - HEAD;

/** 10 years × 10 rows, newest first — the default sort's shape. */
function rows(): Episode[] {
  const out: Episode[] = [];
  let id = 1;
  for (let y = 2010; y > 2000; y--) {
    for (let d = 10; d > 0; d--) {
      out.push({ id, fileHash: `archive:c:${id}.mp3`, fileName: `${id}.mp3`, title: `Show ${id}`, airDate: `${y}-06-${String(d).padStart(2, "0")}` } as Episode);
      id++;
    }
  }
  return out;
}

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

function mount(episodes: Episode[], sortMode: "date" | "date-asc" | "progress" = "date", activeRow = -1) {
  act(() => {
    root.render(createElement(TimelineView, { episodes, sortMode, onEpisodeClick: () => {}, activeRow }));
  });
}

const rail = () => host.querySelector('[data-testid="year-rail"]');
const entries = () => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="year-rail"] [data-group]')];
const active = () => entries().filter((e) => e.getAttribute("aria-current") === "true").map((e) => e.dataset.group);
const scroller = () => host.querySelector('[role="listbox"]')!.parentElement as HTMLDivElement;

function scrollTo(top: number) {
  act(() => {
    scroller().scrollTop = top;
    scroller().dispatchEvent(new Event("scroll"));
  });
}

describe("TimelineView rail", () => {
  it("runs in the list's order, top to bottom, for both date directions", () => {
    const list = rows();
    mount(list);
    expect(entries().map((e) => e.dataset.group)).toEqual(["2010", "2009", "2008", "2007", "2006", "2005", "2004", "2003", "2002", "2001"]);
    mount([...list].reverse(), "date-asc");
    expect(entries().map((e) => e.dataset.year)).toEqual(["2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009", "2010"]);
  });

  it("marks the group of the first visible row active — not an overscan row five rows above it", () => {
    mount(rows());
    expect(active()).toEqual(["2010"]);
    // Row 10 (the first 2009 row) is at the top of the viewport. Rows 5–9,
    // still 2010, are rendered above it as overscan.
    scrollTo(top(10));
    expect(active()).toEqual(["2009"]);
    // One pixel short of 2008's header: row 19 (2009) is still the first visible.
    scrollTo(headerTop(20) - 1);
    expect(active()).toEqual(["2009"]);
    // 2008's header at the top: 2008 is the group in view.
    scrollTo(headerTop(20));
    expect(active()).toEqual(["2008"]);
  });

  it("the sticky header names the same group", () => {
    mount(rows());
    scrollTo(top(30));
    expect(host.querySelector('[data-testid="rail-header-group"]')?.getAttribute("data-group")).toBe("2007");
  });

  it("the sticky header stands down while the group's own inline header is at the top", () => {
    mount(rows());
    scrollTo(headerTop(30));
    const label = host.querySelector('[data-testid="rail-header-group"]')!;
    expect(label.classList.contains("invisible")).toBe(true);
    expect(label.getAttribute("aria-hidden")).toBe("true");
    scrollTo(top(30));
    expect(label.classList.contains("invisible")).toBe(false);
    expect(label.hasAttribute("aria-hidden")).toBe(false);
  });

  // The bar sits above the scroller: anything that mounts or unmounts in it
  // as the list moves changes the scroller's height after "keep the active
  // row in view" has measured it, and End left the last row below the fold
  // (e2e/listbox.spec.ts measures that in Chromium; jsdom has no layout, so
  // this pins the cause — the bar's content must not depend on scroll).
  it("the sticky header's content does not change with the scroll position", () => {
    for (const mode of ["date", "date-asc"] as const) {
      mount(mode === "date" ? rows() : [...rows()].reverse(), mode);
      const shape = () => {
        const bar = host.querySelector('[data-testid="rail-header"]');
        return bar ? [...bar.querySelectorAll("*")].map((e) => e.tagName).join(",") : null;
      };
      const bar = host.querySelector('[data-testid="rail-header"]');
      const atHeader = shape();
      expect(atHeader).not.toBeNull();
      for (const y of [top(3), headerTop(30), top(55), headerTop(90), top(99)]) {
        scrollTo(y);
        expect(host.querySelector('[data-testid="rail-header"]')).toBe(bar);
        expect(shape()).toBe(atHeader);
      }
      scrollTo(0);
    }
  });

  // Keyboard navigation scrolls the active row into view. Moving up onto a
  // group's first row must bring its header too — Home used to stop at row 0's
  // own top, 26px down, with the first group's title scrolled away above it.
  it("moving the active row up onto a group's first row shows that group's header", () => {
    const list = rows();
    mount(list);
    Object.defineProperty(scroller(), "clientHeight", { configurable: true, value: 340 });
    mount(list, "date", 99);
    expect(scroller().scrollTop).toBeGreaterThan(headerTop(90));
    mount(list, "date", 35); // mid-group: the row itself at the top
    expect(scroller().scrollTop).toBe(top(35));
    mount(list, "date", 30); // first of 2007: its header at the top
    expect(scroller().scrollTop).toBe(headerTop(30));
    mount(list, "date", 0); // Home
    expect(scroller().scrollTop).toBe(0);
  });

  it("clicking an entry puts that group's header at the top of the list", () => {
    mount(rows());
    const target = entries().find((e) => e.dataset.group === "2006")!;
    act(() => target.click());
    // 2006 starts at row 40; its header sits directly above it.
    expect(scroller().scrollTop).toBe(headerTop(40));
    expect(active()).toEqual(["2006"]);
  });

  it("every group in the rendered window has an inline header, with its row count", () => {
    mount(rows());
    // At the top: 2010's header, and — within the window plus overscan — 2009's.
    const headers = () =>
      [...host.querySelectorAll<HTMLElement>('[data-testid="group-header"]')].map((h) => ({
        group: h.dataset.group,
        count: h.dataset.count,
        text: h.textContent,
        top: h.style.top,
      }));
    expect(headers()[0]).toEqual({ group: "2010", count: "10", text: "201010 episodes", top: "0px" });
    scrollTo(headerTop(50));
    const inView = headers();
    expect(inView.map((h) => h.group)).toContain("2005");
    for (const h of inView) {
      expect(h.count).toBe("10");
      expect(h.text).toBe(`${h.group}10 episodes`);
    }
    expect(inView.find((h) => h.group === "2005")?.top).toBe(`${headerTop(50)}px`);
  });

  it("has no rail where the sort has no groups", () => {
    mount(rows(), "progress");
    expect(rail()).toBeNull();
  });

  it("uses the text ramp: no sub-token sizes or sub-/85 opacity on the rail", () => {
    mount(rows());
    const html = rail()!.innerHTML;
    expect(html).not.toMatch(/text-\[\d+px\]/);
    expect(html).not.toMatch(/opacity-(?:[0-7]\d|80)\b/);
    expect(html).toContain("text-hd-micro");
  });
});

describe("NothingInProgress", () => {
  it("says nothing is in progress, and offers the full list back", () => {
    const onShowAll = vi.fn();
    act(() => root.render(createElement(NothingInProgress, { narrowed: false, onShowAll })));
    expect(host.textContent).toContain("Nothing half-listened yet.");
    expect(host.textContent).not.toContain("No episodes");
    act(() => host.querySelector("button")!.click());
    expect(onShowAll).toHaveBeenCalledOnce();
  });
});
