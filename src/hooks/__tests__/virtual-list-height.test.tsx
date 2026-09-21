import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useVirtualList } from "@/hooks/useVirtualList";

/**
 * HD-035: the virtual list must track its container's height even when the
 * first render had no container.
 *
 * TimelineView renders its empty state — no scroller at all — while the list
 * is empty, and the hook used to observe `ref.current` in an effect keyed on
 * the ref *object*, which never changes. So after an empty first render the
 * ResizeObserver was never attached, and the window stayed sized for the
 * 600px default however tall the list really was.
 *
 * ResizeObserver is stubbed (jsdom has none); the hook is real. The stub
 * records which elements are observed and lets the test deliver a resize.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type Cb = (entries: { contentRect: { height: number } }[]) => void;
const observers: { cb: Cb; targets: Element[]; live: boolean }[] = [];
class FakeResizeObserver {
  private rec: { cb: Cb; targets: Element[]; live: boolean };
  constructor(cb: Cb) {
    this.rec = { cb, targets: [], live: true };
    observers.push(this.rec);
  }
  observe(el: Element) { this.rec.targets.push(el); }
  unobserve() {}
  disconnect() { this.rec.live = false; }
}
globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;

function resize(el: Element, height: number) {
  for (const o of observers) if (o.live && o.targets.includes(el)) act(() => o.cb([{ contentRect: { height } }]));
}

const ROW = 10;
let rendered = 0;
const publish = (n: number) => { rendered = n; };

/** Mirrors TimelineView's shape: no scroller at all while there are no items. */
function List({ items }: { items: number[] }) {
  const { containerRef, virtualItems } = useVirtualList({ items, itemHeight: ROW, overscan: 0 });
  useEffect(() => publish(virtualItems.length));
  if (items.length === 0) return createElement("p", null, "empty");
  return createElement("div", { ref: containerRef, "data-testid": "scroller" });
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  observers.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const items = Array.from({ length: 1000 }, (_, i) => i);

describe("useVirtualList height tracking", () => {
  it("observes the scroller that mounts after an empty first render", () => {
    act(() => root.render(createElement(List, { items: [] })));
    act(() => root.render(createElement(List, { items })));
    const scroller = host.querySelector('[data-testid="scroller"]')!;
    expect(observers.some((o) => o.live && o.targets.includes(scroller))).toBe(true);

    // The default assumes 600px: 60 rows (+1 for the partial row).
    expect(rendered).toBe(61);
    resize(scroller, 2000);
    expect(rendered).toBe(201);
  });

  it("re-observes a scroller that is replaced", () => {
    act(() => root.render(createElement(List, { items })));
    act(() => root.render(createElement(List, { items: [] })));
    act(() => root.render(createElement(List, { items })));
    const scroller = host.querySelector('[data-testid="scroller"]')!;
    resize(scroller, 300);
    expect(rendered).toBe(31);
  });
});
