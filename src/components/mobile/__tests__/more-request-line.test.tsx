import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The Request Line in Night's More menu on a phone (2026-10-14,
 * docs/request-line.md): one tap from anywhere to tonight's picks, beside
 * the Dial and Statistics under Navigate.
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
  it("is under Navigate and goes to /request-line", async () => {
    act(() => root.render(createElement(MobileMenuSheet, { open: true, onClose: () => {}, isAdmin: false, onAbout: () => {} })));
    const item = host.querySelector<HTMLButtonElement>('[data-testid="more-request-line"]');
    expect(item?.textContent).toContain("Request Line");
    // Listed with the places, not the settings.
    const all = Array.from(host.querySelectorAll("button, span")).map((el) => el.textContent?.trim());
    expect(all.indexOf("Navigate")).toBeGreaterThan(-1);
    expect(all.indexOf("Navigate")).toBeLessThan(all.indexOf("Request Line"));
    act(() => item!.click());
    expect(push).toHaveBeenCalledWith("/request-line");
  });
});
