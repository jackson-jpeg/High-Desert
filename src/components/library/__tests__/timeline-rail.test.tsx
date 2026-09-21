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
vi.mock("@/hooks/useCommunityStats", () => ({ useCommunityStats: () => new Map() }));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

const { TimelineView } = await import("@/components/library/TimelineView");
const { NothingInProgress } = await import("@/components/library/LibraryListStates");
const { itemHeightFor } = await import("@/hooks/useTextScale");

const ROW = itemHeightFor(false, 1); // 34 on desktop at 1x

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

function mount(episodes: Episode[], sortMode: "date" | "date-asc" | "progress" = "date") {
  act(() => {
    root.render(createElement(TimelineView, { episodes, sortMode, onEpisodeClick: () => {} }));
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
    scrollTo(10 * ROW);
    expect(active()).toEqual(["2009"]);
    // One pixel short of row 20: row 19 (2009) is still the first visible.
    scrollTo(20 * ROW - 1);
    expect(active()).toEqual(["2009"]);
    scrollTo(20 * ROW);
    expect(active()).toEqual(["2008"]);
  });

  it("the sticky header names the same group", () => {
    mount(rows());
    scrollTo(30 * ROW);
    expect(host.querySelector('[data-testid="rail-header-group"]')?.getAttribute("data-group")).toBe("2007");
  });

  it("clicking an entry puts that group's first row at the top of the list", () => {
    mount(rows());
    const target = entries().find((e) => e.dataset.group === "2006")!;
    act(() => target.click());
    // 2006 starts at row 40.
    expect(scroller().scrollTop).toBe(40 * ROW);
    expect(active()).toEqual(["2006"]);
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
