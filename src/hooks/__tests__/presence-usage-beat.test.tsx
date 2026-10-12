import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Time per tab rides on the minute beat and only on it (docs/usage-tracking.md).
 * The extra beats (on mount, on coming back to the tab, on a live change)
 * must not carry it, or each would add a minute that was never spent.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const beats = vi.hoisted(() => [] as unknown[]);
vi.mock("@/services/stats/client", () => ({
  reportHeartbeat: (_s: string, _e: string | null, _live?: boolean, usage?: unknown) => {
    beats.push(usage ?? null);
    return Promise.resolve();
  },
}));
vi.mock("@/services/stats/now-feed", () => ({ refreshNow: vi.fn() }));
vi.mock("@/hooks/useCommunityNow", () => ({
  useCommunityNow: () => ({ online: 0, listening: 0, poll: 0 }),
}));

const { usePresence } = await import("@/hooks/usePresence");

function Probe() {
  usePresence();
  return null;
}

let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  beats.length = 0;
  localStorage.clear();
  window.history.replaceState({}, "", "/radio");
  root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("the minute beat carries the tab", () => {
  it("the first beat carries nothing; each minute beat carries the tab and that the page is on screen", () => {
    expect(beats).toEqual([null]);
    act(() => vi.advanceTimersByTime(60_000));
    window.history.replaceState({}, "", "/live");
    act(() => vi.advanceTimersByTime(60_000));
    expect(beats).toEqual([
      null,
      { route: "radio", device: "desktop", visible: true },
      { route: "live", device: "desktop", visible: true },
    ]);
  });

  it("coming back to the tab beats at once, without a minute", () => {
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(beats).toEqual([null, null]);
  });
});
