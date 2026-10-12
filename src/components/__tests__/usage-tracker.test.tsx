import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A view per tab entered and held (docs/usage-tracking.md), client-side
 * navigation included, with the session's arrival on the first one. The real
 * component and the real client; `fetch` and the router's pathname are the
 * only stand-ins.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const { UsageTracker, VIEW_SETTLE_MS } = await import("@/components/UsageTracker");

let root: Root;
let sent: Record<string, unknown>[];

function render(pathname: string) {
  nav.pathname = pathname;
  act(() => root.render(<UsageTracker />));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/stats/view");
      sent.push(JSON.parse(String(init.body)));
      return new Response("{}");
    }),
  );
  Object.defineProperty(document, "referrer", { value: "https://www.reddit.com/r/artbell", configurable: true });
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("UsageTracker", () => {
  it("counts each tab entered, client-side navigation included, the arrival on the first", () => {
    render("/live");
    act(() => vi.advanceTimersByTime(VIEW_SETTLE_MS));
    render("/library");
    act(() => vi.advanceTimersByTime(VIEW_SETTLE_MS));
    render("/live");
    act(() => vi.advanceTimersByTime(VIEW_SETTLE_MS));
    expect(sent).toEqual([
      { route: "live", device: "desktop", arrival: { source: "reddit", landing: "live" } },
      { route: "library", device: "desktop" },
      { route: "live", device: "desktop" },
    ]);
  });

  it("does not count a tab left within the settle time (the welcome page's bounce)", () => {
    render("/");
    act(() => vi.advanceTimersByTime(VIEW_SETTLE_MS - 1));
    render("/library");
    act(() => vi.advanceTimersByTime(VIEW_SETTLE_MS));
    // The arrival still lands where the session landed, on the welcome page.
    expect(sent).toEqual([{ route: "library", device: "desktop", arrival: { source: "reddit", landing: "welcome" } }]);
  });

  it("a re-render on the same tab is not another view", () => {
    render("/stats");
    act(() => vi.advanceTimersByTime(VIEW_SETTLE_MS));
    render("/stats");
    act(() => vi.advanceTimersByTime(VIEW_SETTLE_MS * 3));
    expect(sent).toHaveLength(1);
  });
});
