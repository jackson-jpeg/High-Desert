import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Look } from "@/lib/look/look";

/**
 * The preview looks retire the Radio tab (src/lib/look/nav.ts); the public
 * look keeps it. Mounts the real shell, its real menus and mobile sheet, and
 * the real command palette, in each look, and reads what a visitor can reach.
 * Each preview assertion has the public look beside it as the control: a
 * Radio entry that never rendered at all would pass "no Radio" too.
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
  if (look === "default") document.documentElement.removeAttribute("data-look");
  else document.documentElement.setAttribute("data-look", look);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
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

describe("the Radio tab per look", () => {
  it("control: the public look keeps its Radio tab, menu item and sheet entry", () => {
    mount("default", shell());
    expect(navTabs()).toEqual(["Library", "Live", "Radio", "Stats", "More"]);
    // The tab-bar icon hooks are the preview looks' alone: no new attribute here.
    expect(container.querySelector("nav [data-nav]")).toBeNull();
    click(byText('[role="menubar"] [role="menuitem"]', "View")!);
    const item = byText('[role="menu"] [role="menuitem"]', "Radio Dial");
    expect(item).toBeTruthy();
    click(item!);
    expect(push).toHaveBeenCalledWith("/radio");
    expect(byText('[role="menu"] [role="menuitem"]', "Library Dial")).toBeUndefined();
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    click(container.querySelector('button[aria-label="More options"]')!);
    expect(sheetRow("Radio Dial")).toBeTruthy();
    expect(sheetRow("Library Dial")).toBeUndefined();
  });

  for (const look of ["clean", "win98"] as const) {
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

  it("control: the public look offers the Radio Dial", () => {
    mount("default", createElement(CommandPalette, { open: true, onClose: () => {} }));
    expect(goTo().some((t) => t.includes("Radio Dial"))).toBe(true);
    click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Radio Dial"))!);
    expect(push).toHaveBeenCalledWith("/radio");
  });

  it("a preview look offers the Library Dial, which opens the Dial mode", () => {
    mount("clean", createElement(CommandPalette, { open: true, onClose: () => {} }));
    expect(goTo().some((t) => t.includes("Radio Dial"))).toBe(false);
    click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Library Dial"))!);
    expect(push).toHaveBeenCalledWith("/library?view=dial");
  });
});
