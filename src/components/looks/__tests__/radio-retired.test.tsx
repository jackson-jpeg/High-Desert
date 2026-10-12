import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Look } from "@/lib/look/look";
import { LookProvider } from "@/hooks/useLook";

/**
 * There is no Radio tab in either look (src/lib/look/nav.ts): the dial is the
 * Library's Dial mode. Mounts the real shell, its real menus and mobile
 * sheet, and the real command palette, in each look, and reads what a
 * visitor can reach. Every "no Radio" sits beside a positive "Library Dial is
 * there and opens the dial", so a menu that never rendered cannot pass.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const push = vi.fn();
// One router object, as Next's is: the palette's actions are memoised on it.
const router = { push, replace: vi.fn() };
const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/library",
}));
vi.mock("@/hooks/usePresence", () => ({ usePresence: () => ({ online: 0, listening: 0 }) }));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => undefined }));
vi.mock("@/db", () => ({
  db: { episodes: { toArray: async () => [] } },
  getPreference: () => new Promise(() => {}),
  setPreference: async () => {},
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => false, useMediaQuery: () => false }));
vi.mock("@/components/desktop/Starfield", () => ({ Starfield: () => null }));

const { DesktopShell } = await import("@/components/desktop/DesktopShell");
const { CommandPalette } = await import("@/components/CommandPalette");

let root: Root;
let container: HTMLDivElement;

function mount(look: Look, node: React.ReactNode) {
  document.documentElement.setAttribute("data-look", look);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(LookProvider, { look }, node)));
}

const shell = () => <DesktopShell episodeCount={10}>{null}</DesktopShell>;
const navTabs = () => [...container.querySelectorAll("nav button")].map((b) => b.textContent?.trim() ?? "");
const click = (el: Element) => act(() => (el as HTMLElement).click());
const byText = (sel: string, text: string) =>
  [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim() === text);
/** A More-sheet row: an icon span, then the label. */
const sheetRow = (text: string) =>
  [...document.querySelectorAll("button")].find((e) => e.textContent?.trim().endsWith(text));

beforeEach(() => {
  push.mockClear();
  replaceState.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.removeAttribute("data-look");
});

describe("no Radio tab in either look", () => {
  // Win98 replaces the tabs with its taskbar (src/components/looks/win98),
  // whose Start menu is held to "never Radio" by start-menu.test.ts.
  it("win98: the taskbar stands in for the tabs, and no Radio tab is drawn", () => {
    mount("win98", shell());
    expect(container.querySelector('nav[aria-label="Taskbar"]')).toBeTruthy();
    expect(navTabs()).not.toContain("Radio");
  });

  for (const look of ["night"] as const) {
    it(`${look}: no Radio tab; the menu and the More sheet open the Library's Dial mode`, () => {
      mount(look, shell());
      expect(navTabs()).toEqual(["Library", "Live", "Stats", "More"]);
      expect([...container.querySelectorAll<HTMLElement>("nav button[data-nav]")].map((e) => e.dataset.nav)).toEqual([
        "library",
        "live",
        "stats",
        "more",
      ]);

      click(byText('[role="menubar"] [role="menuitem"]', "View")!);
      expect(byText('[role="menu"] [role="menuitem"]', "Radio Dial")).toBeUndefined();
      click(byText('[role="menu"] [role="menuitem"]', "Library Dial")!);
      // On /library an intent replaces the entry rather than pushing one.
      expect(replaceState).toHaveBeenCalledWith(null, "", "/library?view=dial");
      expect(push).not.toHaveBeenCalledWith("/radio");

      replaceState.mockClear();
      click(container.querySelector('button[aria-label="More options"]')!);
      expect(sheetRow("Statistics")).toBeTruthy();
      expect(sheetRow("Radio Dial")).toBeUndefined();
      click(sheetRow("Library Dial")!);
      expect(replaceState).toHaveBeenCalledWith(null, "", "/library?view=dial");
    });
  }
});

describe("the command palette per look", () => {
  const goTo = () =>
    [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? "");

  it("offers the Library Dial, which opens the Dial mode", () => {
    mount("night", createElement(CommandPalette, { open: true, onClose: () => {} }));
    expect(goTo().some((t) => t.includes("Radio Dial"))).toBe(false);
    click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Library Dial"))!);
    expect(push).toHaveBeenCalledWith("/library?view=dial");
  });
});
