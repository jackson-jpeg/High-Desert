import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Menu } from "@/components/win98";

/**
 * useShellMenus, extracted from DesktopShell (HD-018).
 *
 * The menus are data plus handlers; this drives the handlers and checks what
 * they reach — the router (library actions are URL intents, HD-013), the
 * shell's callbacks —
 * rather than the labels alone. The admin-only items are UI gating, not
 * protection (CLAUDE.md, "Admin Mode"), but a visitor seeing "Clear Library..."
 * is still a bug.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
const replace = vi.fn();
let pathname = "/library";
const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => pathname,
}));

const { useShellMenus } = await import("@/hooks/useShellMenus");
const { useAdminStore } = await import("@/stores/admin-store");

const actions = {
  onAbout: vi.fn(),
  onShortcuts: vi.fn(),
  onClearLibrary: vi.fn(),
  onClearCache: vi.fn(),
  startupSoundOn: true,
  onToggleStartupSound: vi.fn(),
  textScale: "1.15" as const,
  onSetTextScale: vi.fn(),
};

let menus: Menu[];
const capture = (m: Menu[]) => { menus = m; };
function Probe({ onMenus }: { onMenus: (m: Menu[]) => void }) {
  onMenus(useShellMenus(actions));
  return null;
}

let root: Root;
let container: HTMLDivElement;

function mount(isAdmin: boolean) {
  useAdminStore.setState({ isAdmin });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(Probe, { onMenus: capture }));
  });
}

const menu = (label: string) => menus.find((m) => m.label === label);
const item = (menuLabel: string, label: string) =>
  menu(menuLabel)?.items.find((i) => i.label === label);

beforeEach(() => {
  vi.clearAllMocks();
  replaceState.mockImplementation(() => {});
  pathname = "/library";
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useShellMenus", () => {
  it("View's sort items carry the sort key to the library as a URL intent", () => {
    mount(false);
    item("View", "Sort by Date")!.onClick!();
    item("View", "Most Played")!.onClick!();
    // On /library itself: replace the history entry, so the intent adds none.
    expect(replaceState.mock.calls.map((c) => c[2])).toEqual(["/library?sort=date", "/library?sort=played"]);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("from another route, sort and shuffle navigate to /library with the intent (HD-013)", () => {
    pathname = "/stats";
    mount(false);
    item("View", "Shuffle Coast to Coast")!.onClick!();
    item("View", "Sort by Guest")!.onClick!();
    item("View", "Surprise Me — Shuffle All")!.onClick!();
    expect(push.mock.calls.map((c) => c[0])).toEqual([
      "/library?shuffle=coast",
      "/library?sort=guest",
      "/library?shuffle=all",
    ]);
    expect(replace).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("hides the Library menu and admin items from visitors", () => {
    mount(false);
    expect(menus.map((m) => m.label)).toEqual(["File", "View", "Help"]);
    expect(item("File", "Open Folder...")).toBeUndefined();
    expect(item("Help", "Log Out of Admin")).toBeUndefined();
  });

  it("gives admins the Library menu, wired to the shell's dialogs", () => {
    mount(true);
    expect(menus.map((m) => m.label)).toEqual(["File", "View", "Library", "Help"]);
    item("Library", "Clear Library...")!.onClick!();
    item("Library", "Clear Audio Cache...")!.onClick!();
    item("Library", "Search Archive...")!.onClick!();
    expect(actions.onClearLibrary).toHaveBeenCalledTimes(1);
    expect(actions.onClearCache).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/search");
  });

  it("checks the text size in effect and sets the one picked", () => {
    mount(false);
    const sizes = menu("Help")!.items.filter((i) => i.label.startsWith("Text Size"));
    expect(sizes.map((i) => i.label)).toEqual([
      "Text Size: Normal",
      "Text Size: Large ✓",
      "Text Size: Extra Large",
    ]);
    sizes[2].onClick!();
    expect(actions.onSetTextScale).toHaveBeenCalledWith("1.3");
  });

  it("offers Install App only once the browser has offered it", () => {
    mount(false);
    expect(item("Help", "Install App...")).toBeUndefined();
    act(() => root.unmount());
    container.remove();
    const onInstall = vi.fn();
    Object.assign(actions, { onInstall });
    mount(false);
    item("Help", "Install App...")!.onClick!();
    expect(onInstall).toHaveBeenCalled();
    delete (actions as { onInstall?: unknown }).onInstall;
  });
});
