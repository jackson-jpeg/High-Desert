import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";

/**
 * The phone's year scrubber, mounted inside the real TimelineView at a mobile
 * breakpoint: it appears on scroll, hides after the idle period, and a drag
 * down the track jumps the list to the group under the finger.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => true,
  useMediaQuery: () => false,
}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

const { TimelineView, SCRUBBER_IDLE_MS } = await import("@/components/library/TimelineView");
const { itemHeightFor, headerHeightFor } = await import("@/hooks/useTextScale");
const { scrubberIndexAt } = await import("@/lib/library/rail-groups");

const ROW = itemHeightFor(true, 1); // 116 on a phone at 1x
const HEAD = headerHeightFor(true, 1); // 32: the inline header above each group's first row
/** Top of row `i` (ten rows a group): rows above, plus a header per group so far. Plain arithmetic, not list-layout. */
const top = (i: number) => i * ROW + (Math.floor(i / 10) + 1) * HEAD;
/** Top of the header of the group starting at row `first`. */
const headerTop = (first: number) => top(first) - HEAD;

/** 10 years × 10 rows. */
function rows(desc = true): Episode[] {
  const out: Episode[] = [];
  let id = 1;
  for (let k = 0; k < 10; k++) {
    const y = desc ? 2010 - k : 2001 + k;
    for (let d = 0; d < 10; d++) {
      out.push({ id, fileHash: `archive:c:${id}.mp3`, fileName: `${id}.mp3`, title: `Show ${id}`, airDate: `${y}-06-${String(desc ? 20 - d : 10 + d).padStart(2, "0")}` } as Episode);
      id++;
    }
  }
  return out;
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function mount(episodes: Episode[], sortMode: "date" | "date-asc" = "date") {
  act(() => root.render(createElement(TimelineView, { episodes, sortMode, onEpisodeClick: () => {} })));
}
const scrubber = () => host.querySelector<HTMLElement>('[data-testid="year-scrubber"]')!;
const track = () => scrubber().querySelector<HTMLElement>("nav")!;
const labels = () => [...scrubber().querySelectorAll<HTMLElement>("[data-group]")].map((e) => e.dataset.group);
const active = () => [...scrubber().querySelectorAll<HTMLElement>('[aria-current="true"]')].map((e) => e.dataset.group);
const scroller = () => host.querySelector('[role="listbox"]')!.parentElement as HTMLDivElement;

function scrollTo(top: number) {
  act(() => {
    scroller().scrollTop = top;
    scroller().dispatchEvent(new Event("scroll"));
  });
}

/** A 500px track from y=100; 10 groups, so 50px slots. */
function layoutTrack() {
  track().getBoundingClientRect = () => ({ top: 100, height: 500, bottom: 600, left: 0, right: 44, width: 44, x: 0, y: 100, toJSON() {} }) as DOMRect;
}
function pointer(type: string, clientY: number) {
  // jsdom has no PointerEvent; React reads clientY and pointerId off a MouseEvent just the same.
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  act(() => track().dispatchEvent(ev));
}

describe("YearScrubber", () => {
  it("is a projection of the list: labels in list order, for both date directions", () => {
    mount(rows(true));
    expect(labels()).toEqual(["2010", "2009", "2008", "2007", "2006", "2005", "2004", "2003", "2002", "2001"]);
    mount(rows(false), "date-asc");
    expect(labels()).toEqual(["2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009", "2010"]);
  });

  it("is hidden until the list scrolls, then hides again once it has been idle", () => {
    mount(rows());
    expect(scrubber().dataset.visible).toBe("false");
    expect(scrubber().className).toContain("pointer-events-none");
    scrollTo(3 * ROW);
    expect(scrubber().dataset.visible).toBe("true");
    act(() => vi.advanceTimersByTime(SCRUBBER_IDLE_MS - 100));
    // Still scrolling resets the clock.
    scrollTo(4 * ROW);
    act(() => vi.advanceTimersByTime(SCRUBBER_IDLE_MS - 100));
    expect(scrubber().dataset.visible).toBe("true");
    act(() => vi.advanceTimersByTime(200));
    expect(scrubber().dataset.visible).toBe("false");
  });

  it("tracks the first visible row, not an overscan row", () => {
    mount(rows());
    scrollTo(top(10));
    expect(active()).toEqual(["2009"]);
  });

  it("dragging jumps the list group by group, with the group under the finger in the bubble", () => {
    mount(rows());
    scrollTo(1); // wake it
    layoutTrack();
    pointer("pointerdown", 110); // slot 0
    expect(scroller().scrollTop).toBe(0);
    pointer("pointermove", 100 + 3 * 50 + 25); // slot 3 → 2007, first row 30
    expect(scroller().scrollTop).toBe(headerTop(30));
    expect(host.querySelector('[data-testid="year-scrubber-bubble"]')?.textContent).toBe("2007");
    // Held up while dragging, whatever the idle clock says.
    act(() => vi.advanceTimersByTime(SCRUBBER_IDLE_MS * 3));
    expect(scrubber().dataset.visible).toBe("true");
    pointer("pointermove", 100 + 9 * 50 + 1); // slot 9 → 2001, first row 90
    expect(scroller().scrollTop).toBe(headerTop(90));
    pointer("pointerup", 100 + 9 * 50 + 1);
    expect(host.querySelector('[data-testid="year-scrubber-bubble"]')).toBeNull();
    act(() => vi.advanceTimersByTime(SCRUBBER_IDLE_MS + 10));
    expect(scrubber().dataset.visible).toBe("false");
  });
});

describe("scrubberIndexAt", () => {
  it("maps a y to the equal slot under it, clamped at both ends", () => {
    expect(scrubberIndexAt(100, 100, 500, 10)).toBe(0);
    expect(scrubberIndexAt(149, 100, 500, 10)).toBe(0);
    expect(scrubberIndexAt(150, 100, 500, 10)).toBe(1);
    expect(scrubberIndexAt(599, 100, 500, 10)).toBe(9);
    expect(scrubberIndexAt(5000, 100, 500, 10)).toBe(9);
    expect(scrubberIndexAt(0, 100, 500, 10)).toBe(0);
    expect(scrubberIndexAt(300, 100, 500, 0)).toBe(-1);
  });
});
