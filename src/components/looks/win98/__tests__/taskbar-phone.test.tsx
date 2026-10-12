import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The Win98 taskbar on a phone: Radio's old place is the Phone Lines, between
 * Live and Stats, and it goes to /live?lines=1 (src/lib/live/phone-lines.ts).
 * A desktop keeps three task buttons (taskbar.test.tsx).
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
const mobile = vi.hoisted(() => ({ value: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/live" }));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => mobile.value, useMediaQuery: () => mobile.value }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const { Taskbar } = await import("../Taskbar");

let root: Root;
let container: HTMLDivElement;

function mount() {
  act(() =>
    root.render(
      createElement(Taskbar, {
        isAdmin: false,
        presence: { online: 3, listening: 1, poll: 0 },
        onAbout: vi.fn(),
        onShortcuts: vi.fn(),
        onSettings: vi.fn(),
        onDisplay: vi.fn(),
      }),
    ),
  );
}

const tasks = () =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Places"] button')].map((b) => b.textContent);

beforeEach(() => {
  push.mockClear();
  mobile.value = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the Win98 taskbar on a phone", () => {
  it("has the Phone Lines where Radio was, and it opens them", () => {
    mount();
    expect(tasks()).toEqual(["Library", "Live", "Phone Lines", "Stats"]);
    const lines = container.querySelector<HTMLButtonElement>('[data-testid="w98-task-phone-lines"]')!;
    // Two short lines in a quarter of a phone, not "Phone L…", and a 44 px target.
    expect(lines.className).toMatch(/\bwhitespace-normal\b/);
    expect(lines.className).toMatch(/\bmin-h-touch\b/);
    // On /live, Live is the current place; the lines are not a place of their own.
    expect(lines.getAttribute("aria-current")).toBeNull();
    act(() => lines.click());
    expect(push).toHaveBeenCalledWith("/live?lines=1");
  });

  it("a desktop keeps its three", () => {
    mobile.value = false;
    mount();
    expect(tasks()).toEqual(["Library", "Live", "Stats"]);
  });

  it("the Start menu's Phone Lines goes to the same place", () => {
    mount();
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="w98-start"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="w98-start-phone-lines"]')!.click());
    expect(push).toHaveBeenCalledWith("/live?lines=1");
  });
});
