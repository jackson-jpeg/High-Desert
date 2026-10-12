import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";
import { EpisodeCard } from "@/components/library/EpisodeCard";
import { LookProvider } from "@/hooks/useLook";
import type { Look } from "@/lib/look/look";

/**
 * A row's touch gestures never fire during a scroll (2026-10-12,
 * e2e/scroll-gestures.spec.ts). With a phone's real touch scrolling the long
 * press opened the row's menu mid-scroll: once the browser scrolls natively
 * it stops sending the touchmoves the press watched. And a vertical scroll
 * whose finger drifted sideways could turn into a swipe that queued or
 * favourited the row. Each case has its control: the gesture done on purpose
 * still works, so "nothing happened" is evidence.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

const ep = {
  id: 7,
  fileHash: "archive:coll:7.mp3",
  fileName: "7.mp3",
  archiveIdentifier: "coll",
  title: "Coast to Coast AM - Area 51",
  airDate: "1996-11-02",
  guestName: "Bob Lazar",
  showType: "coast",
  duration: 3 * 3600,
  playCount: 0,
} as unknown as Episode;

function mount(look: Look = "win98") {
  const menu = vi.fn();
  const queue = vi.fn();
  const favorite = vi.fn();
  const card = createElement(EpisodeCard, {
    episode: ep,
    onClick: () => {},
    onContextMenu: menu,
    onQueue: queue,
    onToggleFavorite: favorite,
  });
  act(() => root.render(createElement(LookProvider, { look }, card as ReactNode)));
  const row = host.querySelector<HTMLElement>('[role="option"]')!;
  return { row, menu, queue, favorite };
}

/** A TouchEvent as the page sees it (jsdom has no Touch constructor). */
function touch(el: HTMLElement, type: "touchstart" | "touchmove" | "touchend" | "touchcancel", x: number, y: number) {
  const t = { identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y };
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const ended = type === "touchend" || type === "touchcancel";
  Object.defineProperties(ev, {
    touches: { value: ended ? [] : [t] },
    targetTouches: { value: ended ? [] : [t] },
    changedTouches: { value: [t] },
  });
  act(() => {
    el.dispatchEvent(ev);
  });
}

/** Something on the page scrolled (scroll does not bubble; the press listens in capture). */
function somethingScrolls() {
  const scroller = document.createElement("div");
  document.body.appendChild(scroller);
  act(() => {
    scroller.dispatchEvent(new Event("scroll"));
  });
  scroller.remove();
}

describe("the long press", () => {
  it("control: a finger held still for half a second opens the row's menu", () => {
    const { row, menu } = mount();
    touch(row, "touchstart", 200, 300);
    act(() => vi.advanceTimersByTime(600));
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it("never opens when the page scrolls under the finger, even with no touchmove", () => {
    const { row, menu } = mount();
    touch(row, "touchstart", 200, 300);
    somethingScrolls();
    act(() => vi.advanceTimersByTime(600));
    expect(menu).not.toHaveBeenCalled();
  });

  it("never opens when the browser cancels the touch", () => {
    const { row, menu } = mount();
    touch(row, "touchstart", 200, 300);
    touch(row, "touchcancel", 200, 300);
    act(() => vi.advanceTimersByTime(600));
    expect(menu).not.toHaveBeenCalled();
  });
});

describe("the row swipe", () => {
  it("control: a clearly sideways swipe queues (right) and favourites (left)", () => {
    const { row, queue, favorite } = mount("night");
    touch(row, "touchstart", 100, 300);
    for (const x of [115, 140, 170, 190]) touch(row, "touchmove", x, 302);
    touch(row, "touchend", 190, 302);
    expect(queue).toHaveBeenCalledTimes(1);
    touch(row, "touchstart", 300, 300);
    for (const x of [285, 260, 230, 210]) touch(row, "touchmove", x, 298);
    touch(row, "touchend", 210, 298);
    expect(favorite).toHaveBeenCalledTimes(1);
  });

  it("a scroll that drifts sideways later is still a scroll", () => {
    const { row, queue, favorite } = mount("night");
    touch(row, "touchstart", 100, 300);
    touch(row, "touchmove", 102, 280); // up: a scroll
    for (const x of [140, 180, 200]) touch(row, "touchmove", x, 270);
    touch(row, "touchend", 200, 270);
    expect(queue).not.toHaveBeenCalled();
    expect(favorite).not.toHaveBeenCalled();
  });

  it("a diagonal is not a swipe: it must be twice as far across as down", () => {
    const { row, queue } = mount("night");
    touch(row, "touchstart", 100, 300);
    touch(row, "touchmove", 112, 292);
    touch(row, "touchmove", 190, 250);
    touch(row, "touchend", 190, 250);
    expect(queue).not.toHaveBeenCalled();
  });

  it("never acts when the page scrolled before the swipe was decided, or the touch was cancelled", () => {
    const { row, queue } = mount("night");
    touch(row, "touchstart", 100, 300);
    somethingScrolls();
    for (const x of [130, 170, 190]) touch(row, "touchmove", x, 300);
    touch(row, "touchend", 190, 300);
    expect(queue).not.toHaveBeenCalled();

    touch(row, "touchstart", 100, 300);
    for (const x of [130, 170, 190]) touch(row, "touchmove", x, 300);
    touch(row, "touchcancel", 190, 300);
    expect(queue).not.toHaveBeenCalled();
  });
});
