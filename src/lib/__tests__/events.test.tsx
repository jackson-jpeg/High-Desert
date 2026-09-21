import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { emit, onHdEvent, useHdEvent } from "@/lib/events";

/**
 * The typed bus (HD-019). The transport must stay `window` + `hd:<key>`, since
 * the e2e helpers and anything already listening speak it; and `useHdEvent`
 * must hear with the handler of the latest render while subscribing once.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("emit / onHdEvent", () => {
  it("dispatches a window CustomEvent named hd:<key> carrying the detail", () => {
    const seen: unknown[] = [];
    const raw = (e: Event) => seen.push([e.type, (e as CustomEvent).detail]);
    window.addEventListener("hd:filter-tag", raw);
    emit("filter-tag", "ufo");
    window.removeEventListener("hd:filter-tag", raw);
    expect(seen).toEqual([["hd:filter-tag", "ufo"]]);
  });

  it("hears the transport as typed detail, and stops after unsubscribe", () => {
    const seen: string[] = [];
    const off = onHdEvent("status-message", (msg) => seen.push(msg));
    window.dispatchEvent(new CustomEvent("hd:status-message", { detail: "one" }));
    off();
    emit("status-message", "two");
    expect(seen).toEqual(["one"]);
  });

  it("keys do not cross", () => {
    const heard = vi.fn();
    const off = onHdEvent("toggle-shortcuts", heard);
    emit("toggle-ultra-mini");
    off();
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("useHdEvent", () => {
  it("calls the latest render's handler without re-subscribing", () => {
    const add = vi.spyOn(window, "addEventListener");
    const seen: string[] = [];

    function Probe({ n }: { n: number }) {
      useHdEvent("filter-category", (cat) => seen.push(`${n}:${cat}`));
      return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(createElement(Probe, { n: 0 })));
    act(() => emit("filter-category", "ufo"));
    act(() => root!.render(createElement(Probe, { n: 1 })));
    act(() => root!.render(createElement(Probe, { n: 2 })));
    act(() => emit("filter-category", "ghosts"));

    const subscriptions = add.mock.calls.filter(([type]) => type === "hd:filter-category");
    add.mockRestore();
    expect(seen).toEqual(["0:ufo", "2:ghosts"]);
    expect(subscriptions).toHaveLength(1);
  });

  it("unsubscribes on unmount", () => {
    const heard = vi.fn();
    function Probe() {
      useHdEvent("admin-prompt", heard);
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(createElement(Probe)));
    act(() => root!.unmount());
    root = null;
    emit("admin-prompt");
    expect(heard).not.toHaveBeenCalled();
  });
});
