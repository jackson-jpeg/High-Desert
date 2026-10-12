import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTuningGesture } from "@/hooks/useTuningGesture";
import { useRadioDialStore } from "@/stores/radio-dial-store";

/**
 * The dial's strip tunes on a sideways drag only. A vertical swipe over it is
 * the page scrolling past and must not move the dial (2026-10-12: the strip
 * took every touch, `touch-action: none`, so scrolling the dial screen on a
 * phone tuned it instead). The control drags sideways and does tune.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

function Strip() {
  const ref = useRef<HTMLCanvasElement>(null);
  useTuningGesture({ canvasRef: ref, totalDays: 10_000 });
  return <canvas ref={ref} data-testid="strip" />;
}

function touch(el: Element, type: string, x: number, y: number) {
  const t = { identifier: 1, target: el, clientX: x, clientY: y };
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const ended = type === "touchend" || type === "touchcancel";
  Object.defineProperties(ev, {
    touches: { value: ended ? [] : [t] },
    changedTouches: { value: [t] },
  });
  act(() => {
    el.dispatchEvent(ev);
  });
}

beforeEach(() => {
  useRadioDialStore.setState({ position: 5_000, zoom: 2 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(Strip)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the dial strip's touch", () => {
  it("control: a sideways drag tunes", () => {
    const strip = host.querySelector("canvas")!;
    touch(strip, "touchstart", 200, 100);
    for (const x of [185, 160, 130, 100]) touch(strip, "touchmove", x, 102);
    expect(useRadioDialStore.getState().position).toBeGreaterThan(5_000);
  });

  it("a vertical swipe over it never tunes", () => {
    const strip = host.querySelector("canvas")!;
    touch(strip, "touchstart", 200, 300);
    touch(strip, "touchmove", 203, 285);
    for (const [x, y] of [[230, 250], [260, 200], [300, 150]]) touch(strip, "touchmove", x, y);
    touch(strip, "touchend", 300, 150);
    expect(useRadioDialStore.getState().position).toBe(5_000);
  });
});
