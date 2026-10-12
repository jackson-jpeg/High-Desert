import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Look } from "@/lib/look/look";
import { LookProvider } from "@/hooks/useLook";

/**
 * Anyone can switch looks (docs/looks.md): in Win98, Start > Settings > Display
 * opens Windows' Display Properties; in Night, More > Display (a phone) or
 * View > Display... (the menu bar) opens Night's chooser. Applying a different
 * look calls chooseLook (cookie, then reload: held in choice.test.ts); the look
 * already on screen is never "applied". Mounts the real shell, so the menus,
 * the sheet and the dialogs are the ones a visitor gets.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const chosen = vi.hoisted(() => vi.fn());
vi.mock("@/lib/look/choice", async () => {
  const actual = await vi.importActual<typeof import("@/lib/look/choice")>("@/lib/look/choice");
  return { ...actual, chooseLook: chosen };
});
const mobile = vi.hoisted(() => ({ on: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/library" }));
vi.mock("@/hooks/usePresence", () => ({ usePresence: () => ({ online: 0, listening: 0 }) }));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => undefined }));
vi.mock("@/db", () => ({
  db: { episodes: { toArray: async () => [] } },
  getPreference: () => new Promise(() => {}),
  setPreference: async () => {},
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => mobile.on, useMediaQuery: () => false }));
vi.mock("@/components/desktop/Starfield", () => ({ Starfield: () => null }));

const { DesktopShell } = await import("@/components/desktop/DesktopShell");
const { DisplayProperties } = await import("../win98/DisplayProperties");
const { NightDisplay } = await import("../NightDisplay");

let root: Root;
let container: HTMLDivElement;

function mount(look: Look, node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(LookProvider, { look }, node)));
}

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const settle = () => act(async () => new Promise((r) => setTimeout(r, 50)));
const radio = (id: string) => q(id) as HTMLInputElement;

beforeEach(() => {
  chosen.mockClear();
  mobile.on = false;
  localStorage.setItem("hd-look-offer", "shown"); // keep the first-visit offer out of these
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

describe("Win98: Display Properties", () => {
  it("opens from Start > Settings > Display in the real shell", async () => {
    mount("win98", <DesktopShell episodeCount={10}>{null}</DesktopShell>);
    click(q("w98-start"));
    click(q("w98-start-settings"));
    click(q("w98-start-display"));
    await settle();
    const dialog = q("w98-display")!;
    expect(dialog).not.toBeNull();
    expect(dialog.closest('[role="dialog"]')?.textContent).toContain("Display Properties");
  });

  it("starts on the look on screen; OK with no change only closes", () => {
    const onClose = vi.fn();
    mount("win98", <DisplayProperties onClose={onClose} />);
    expect(radio("w98-display-win98").checked).toBe(true);
    expect((q("w98-display-apply") as HTMLButtonElement).disabled).toBe(true);
    click(q("w98-display-ok"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(chosen).not.toHaveBeenCalled();
  });

  it("picking Night previews it; Apply switches; Cancel never does", () => {
    const onClose = vi.fn();
    mount("win98", <DisplayProperties onClose={onClose} />);
    click(radio("w98-display-night"));
    expect(q("w98-display-desc")!.textContent).toMatch(/Dark/);
    expect(document.querySelector('[data-look-preview="night"]')).not.toBeNull();
    click(q("w98-display-cancel"));
    expect(chosen).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    click(q("w98-display-apply"));
    expect(chosen).toHaveBeenCalledWith("night");
  });

  it("OK applies a change", () => {
    mount("win98", <DisplayProperties onClose={vi.fn()} />);
    click(radio("w98-display-night"));
    click(q("w98-display-ok"));
    expect(chosen).toHaveBeenCalledWith("night");
  });

  it("the schemes are a labelled radio group a screen reader can walk", () => {
    mount("win98", <DisplayProperties onClose={vi.fn()} />);
    const fieldset = q("w98-display")!.querySelector("fieldset")!;
    expect(fieldset.querySelector("legend")?.textContent).toBe("Scheme:");
    const radios = [...fieldset.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(["win98", "night"]);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(radios.every((r) => r.closest("label"))).toBe(true);
  });
});

describe("useLookChoice", () => {
  it("apply() with the look on screen never reloads; with another, switches", async () => {
    const { useLookChoice } = await import("../useLookChoice");
    const seen: ReturnType<typeof useLookChoice>[] = [];
    function Probe({ report }: { report: (c: ReturnType<typeof useLookChoice>) => void }) {
      report(useLookChoice());
      return null;
    }
    mount("win98", <Probe report={(c) => seen.push(c)} />);
    const api = () => seen[seen.length - 1];
    act(() => api().apply());
    expect(chosen).not.toHaveBeenCalled();
    act(() => api().setChoice("night"));
    expect(api().changed).toBe(true);
    act(() => api().apply());
    expect(chosen).toHaveBeenCalledWith("night");
  });
});

describe("the shell and the first-visit offer", () => {
  it("a first Win98 visit gets the offer from the real shell; Night never does", async () => {
    localStorage.removeItem("hd-look-offer");
    mount("win98", <DesktopShell episodeCount={10}>{null}</DesktopShell>);
    await settle();
    expect(q("night-offer")).not.toBeNull();
    act(() => root.unmount());
    container.remove();
    localStorage.removeItem("hd-look-offer");
    mount("night", <DesktopShell episodeCount={10}>{null}</DesktopShell>);
    await settle();
    expect(q("night-offer")).toBeNull();
  });
});

describe("Night: the Display chooser", () => {
  it("opens from More > Display on a phone, showing the look on screen", async () => {
    mobile.on = true;
    mount("night", <DesktopShell episodeCount={10}>{null}</DesktopShell>);
    click(document.querySelector('[data-nav="more"]'));
    expect(q("more-display")!.textContent).toContain("Night");
    click(q("more-display"));
    await act(async () => new Promise((r) => setTimeout(r, 400))); // the sheet's close, then the dynamic chunk
    expect(q("night-display")).not.toBeNull();
    expect(q("night-display")!.getAttribute("role")).toBe("dialog");
  });

  it("opens from View > Display... on a desktop", async () => {
    mount("night", <DesktopShell episodeCount={10}>{null}</DesktopShell>);
    const view = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "View")!;
    click(view);
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.includes("Display..."));
    click(item!);
    await settle();
    expect(q("night-display")).not.toBeNull();
    expect(q("w98-display")).toBeNull();
  });

  it("Apply is off until another look is picked, then switches to it", () => {
    mount("night", <NightDisplay onClose={vi.fn()} />);
    expect(radio("night-display-night").checked).toBe(true);
    expect((q("night-display-apply") as HTMLButtonElement).disabled).toBe(true);
    click(radio("night-display-win98"));
    click(q("night-display-apply"));
    expect(chosen).toHaveBeenCalledWith("win98");
  });

  it("Escape and Cancel close it without switching", () => {
    const onClose = vi.fn();
    mount("night", <NightDisplay onClose={onClose} />);
    act(() => {
      q("night-display")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    click(q("night-display-cancel"));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(chosen).not.toHaveBeenCalled();
  });

  it("uses no em dash", () => {
    mount("night", <NightDisplay onClose={vi.fn()} />);
    expect(document.body.textContent).not.toContain("—");
  });
});
