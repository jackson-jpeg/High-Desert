import { describe, it, expect, afterEach } from "vitest";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useScrollEdges } from "@/hooks/useScrollEdges";

/**
 * The Library's chips and show tabs were cut mid-word at 390 with nothing to
 * say the row scrolls (docs/UI-PLAN.md, push 1). The hook marks the edges
 * with more behind them; scroll-edges.css fades exactly those.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let row: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
  row = null;
});

function Row() {
  const ref = useRef<HTMLDivElement>(null);
  useScrollEdges(ref);
  return <div ref={ref} className="hd-scroll-edges" data-testid="row" />;
}

function mount(scrollWidth: number, clientWidth: number) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // Sizes go on before the hook's first look, as layout would have them.
  const proto = HTMLDivElement.prototype;
  const sw = Object.getOwnPropertyDescriptor(proto, "scrollWidth");
  const cw = Object.getOwnPropertyDescriptor(proto, "clientWidth");
  Object.defineProperty(proto, "scrollWidth", { configurable: true, get: () => scrollWidth });
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => clientWidth });
  try {
    act(() => root!.render(createElement(Row)));
  } finally {
    if (sw) Object.defineProperty(proto, "scrollWidth", sw);
    else delete (proto as { scrollWidth?: number }).scrollWidth;
    if (cw) Object.defineProperty(proto, "clientWidth", cw);
    else delete (proto as { clientWidth?: number }).clientWidth;
  }
  row = host.querySelector<HTMLDivElement>('[data-testid="row"]');
  Object.defineProperty(row!, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(row!, "clientWidth", { configurable: true, value: clientWidth });
  return row!;
}

function scrollTo(el: HTMLElement, left: number) {
  el.scrollLeft = left;
  act(() => {
    el.dispatchEvent(new Event("scroll"));
  });
}

describe("a sideways row's edges", () => {
  it("at the start: more to the right only", () => {
    const el = mount(700, 390);
    expect(el.hasAttribute("data-more-right")).toBe(true);
    expect(el.hasAttribute("data-more-left")).toBe(false);
  });

  it("follows the scroll: both mid-row, left only at the end", () => {
    const el = mount(700, 390);
    scrollTo(el, 150);
    expect(el.hasAttribute("data-more-left")).toBe(true);
    expect(el.hasAttribute("data-more-right")).toBe(true);
    scrollTo(el, 310);
    expect(el.hasAttribute("data-more-left")).toBe(true);
    expect(el.hasAttribute("data-more-right")).toBe(false);
  });

  it("control: a row that fits is not faded at all", () => {
    const el = mount(300, 390);
    expect(el.hasAttribute("data-more-left")).toBe(false);
    expect(el.hasAttribute("data-more-right")).toBe(false);
  });

  it("the stylesheet fades only a marked edge, and the Library's two rows use it", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../../styles/scroll-edges.css"), "utf8");
    expect(css).toMatch(/\.hd-scroll-edges \{[^}]*--fade-r:\s*0px/);
    expect(css).toMatch(/\.hd-scroll-edges\[data-more-right\] \{\s*--fade-r:\s*56px/);
    const lib = (f: string) => readFileSync(path.resolve(import.meta.dirname, "../../components/library", f), "utf8");
    expect(lib("LibraryToolbar.tsx")).toMatch(/ref=\{tabsRef\} className="hd-show-tabs[^"]*hd-scroll-edges/);
    expect(lib("LibraryFilterBars.tsx")).toMatch(/ref=\{rowRef\} className="[^"]*hd-mood-chips hd-scroll-edges/);
  });
});
