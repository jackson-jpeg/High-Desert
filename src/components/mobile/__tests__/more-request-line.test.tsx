import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The Request Line in Night's More menu on a phone (2026-10-14,
 * docs/request-line.md): one tap from anywhere to tonight's picks, at the
 * top under Quick Actions, where a phone sees it without scrolling the sheet
 * (under Navigate it sat below eight sort options).
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
const router = { push, replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/live",
}));

const { MobileMenuSheet } = await import("@/components/mobile/MobileMenuSheet");

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  push.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("More > Request Line", () => {
  it("is at the top, under Quick Actions, and goes to /request-line", async () => {
    act(() => root.render(createElement(MobileMenuSheet, { open: true, onClose: () => {}, isAdmin: false, onAbout: () => {} })));
    const item = host.querySelector<HTMLButtonElement>('[data-testid="more-request-line"]');
    expect(item?.textContent).toContain("Request Line");
    // Above the sorts, not below them.
    const all = Array.from(host.querySelectorAll("button, span")).map((el) => el.textContent?.trim());
    expect(all.indexOf("Quick Actions")).toBeGreaterThan(-1);
    expect(all.indexOf("Quick Actions")).toBeLessThan(all.indexOf("Request Line"));
    expect(all.indexOf("Request Line")).toBeLessThan(all.indexOf("Sort Episodes"));
    act(() => item!.click());
    expect(push).toHaveBeenCalledWith("/request-line");
  });
});
