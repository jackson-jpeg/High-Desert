import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The Win98 taskbar: the Start menu's items and keyboard, and the two ways
 * into Mel's Hole (typing "hole" on the desktop, or its name in Run...).
 * MelsHole itself is loaded with next/dynamic; here the loader is replaced by
 * a marker, which is all the trigger needs to show.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/library" }));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => false, useMediaQuery: () => false }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function MelsHoleMarker() {
      return createElement("div", { "data-testid": "w98-mels-hole" });
    },
}));

const { Taskbar } = await import("../Taskbar");

let root: Root;
let container: HTMLDivElement;
const onAbout = vi.fn();

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
const type = (word: string, target: EventTarget = window) => {
  for (const ch of word) key(ch, {}, target);
};

beforeEach(() => {
  push.mockClear();
  onAbout.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(Taskbar, {
        isAdmin: false,
        presence: { online: 3, listening: 1, poll: 0 },
        onAbout,
        onShortcuts: vi.fn(),
        onSettings: vi.fn(),
      }),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the Start menu", () => {
  it("opens from Start and lists the places, never Radio", () => {
    act(() => q("w98-start")!.click());
    const menu = q("w98-start-menu")!;
    expect(menu).not.toBeNull();
    expect(menu.getAttribute("role")).toBe("menu");
    const text = menu.textContent!;
    for (const label of ["Library", "Live", "Stats", "Phone Lines", "Dial", "About", "Shortcuts", "Help", "Shut Down"]) {
      expect(text).toContain(label);
    }
    expect(text.toLowerCase()).not.toContain("radio");
    expect(q("w98-start")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens with Ctrl+Esc, focuses the first item, and moves with the arrows", async () => {
    key("Escape", { ctrlKey: true });
    expect(q("w98-start-menu")).not.toBeNull();
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(document.activeElement).toBe(q("w98-start-library"));
    key("ArrowDown", {}, document.activeElement!);
    expect(document.activeElement).toBe(q("w98-start-live"));
    key("ArrowUp", {}, document.activeElement!);
    key("ArrowUp", {}, document.activeElement!);
    expect(document.activeElement).toBe(q("w98-start-shutdown"));
  });

  it("picks an item by its underlined letter, and routes", async () => {
    act(() => q("w98-start")!.click());
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    key("d", {}, document.activeElement!);
    expect(push).toHaveBeenCalledWith("/library?view=dial");
    expect(q("w98-start-menu")).toBeNull();
  });

  it("closes on Escape and gives focus back to Start", async () => {
    act(() => q("w98-start")!.click());
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    key("Escape", {}, document.activeElement!);
    expect(q("w98-start-menu")).toBeNull();
    expect(document.activeElement).toBe(q("w98-start"));
  });

  it("runs About through the shell's own handler", () => {
    act(() => q("w98-start")!.click());
    act(() => q("w98-start-about")!.click());
    expect(onAbout).toHaveBeenCalledTimes(1);
  });
});

describe("Mel's Hole", () => {
  it("is not on screen until asked for", () => {
    expect(q("w98-mels-hole")).toBeNull();
  });

  it("opens when 'hole' is typed with nothing focused", () => {
    type("hol");
    expect(q("w98-mels-hole")).toBeNull();
    type("e");
    expect(q("w98-mels-hole")).not.toBeNull();
  });

  it("does not open while typing in a field", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    type("hole", input);
    expect(q("w98-mels-hole")).toBeNull();
    input.remove();
  });

  it("does not open for a near miss", () => {
    type("hold");
    type("hoe");
    expect(q("w98-mels-hole")).toBeNull();
  });

  it("counts the word inside a longer one ('whole' ends in it)", () => {
    type("whole");
    expect(q("w98-mels-hole")).not.toBeNull();
  });

  it("opens from Run... by name", () => {
    act(() => q("w98-start")!.click());
    act(() => q("w98-start-run")!.click());
    const input = q("w98-run-input") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Mel's Hole");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => q("w98-run-ok")!.click());
    expect(q("w98-mels-hole")).not.toBeNull();
  });

  it("refuses an unknown program in Run... with Windows' message", () => {
    act(() => q("w98-start")!.click());
    act(() => q("w98-start-run")!.click());
    const input = q("w98-run-input") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "doom.exe");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => q("w98-run-ok")!.click());
    expect(q("w98-run-error")!.textContent).toContain("Cannot find the file 'doom.exe'");
    expect(q("w98-mels-hole")).toBeNull();
  });
});

describe("the route mark", () => {
  it("names the route on <html> for the look's CSS, and clears it on unmount", () => {
    expect(document.documentElement.dataset.w98Route).toBe("/library");
    act(() => root.unmount());
    expect(document.documentElement.dataset.w98Route).toBeUndefined();
    root = createRoot(container);
  });
});

describe("the tray", () => {
  it("shows the shared presence figure, tagged as a presence surface", () => {
    const tray = q("w98-tray-online")!;
    expect(tray.textContent).toContain("3");
    expect(document.querySelector('[data-presence="taskbar"]')).not.toBeNull();
  });
});
