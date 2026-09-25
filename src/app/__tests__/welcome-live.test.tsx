import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A first-time visitor lands on the welcome page, and it said nothing about
 * the live station: the only way in was the archive. Found walking the site as
 * a first-time listener (docs/live-qa.md).
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/db", () => ({ db: { episodes: { count: async () => 0 } } }));
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const { default: WelcomePage } = await import("../page");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  push.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("the welcome page", () => {
  it("offers the live station to a first-time visitor, and takes them there", () => {
    act(() => root.render(createElement(WelcomePage)));
    const live = host.querySelector<HTMLButtonElement>('[data-testid="welcome-live"]');
    expect(live?.textContent).toMatch(/TUNE IN LIVE/);
    act(() => live!.click());
    act(() => vi.advanceTimersByTime(600));
    expect(push).toHaveBeenCalledWith("/live");
    // Marked visited, like entering the archive: next time goes straight in.
    expect(localStorage.getItem("hd-visited")).toBe("1");
  });

  it("entering the archive still goes to the library", () => {
    act(() => root.render(createElement(WelcomePage)));
    const enter = [...host.querySelectorAll("button")].find((b) => b.textContent === "ENTER THE ARCHIVE")!;
    act(() => enter.click());
    act(() => vi.advanceTimersByTime(600));
    expect(push).toHaveBeenCalledWith("/library");
  });
});
