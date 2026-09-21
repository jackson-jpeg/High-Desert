import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, useState, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * HD-022: the Command Palette and the mobile menu sheet are real modal
 * dialogs, through the shared `useFocusTrap` (src/hooks/useFocusTrap.ts).
 *
 * The palette had no dialog role and no trap, so Tab walked out into the page
 * behind it; and its Escape did not stop propagation, so the library's
 * window-level Escape also ran and closed the detail panel under it. Both are
 * observed the way the page behind would observe them: a `keydown` listener
 * on `window`, which is where the library, the radio and the shell listen.
 *
 * jsdom moves no focus on Tab, so "Tab stays inside" is read the way a
 * browser decides it: the trap prevented the default move and put focus
 * where the wrap goes.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
// One router object, as Next gives: the palette's actions are memoised on it,
// and a fresh object per render re-runs its search effect forever.
const router = { push, replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/stats",
}));

const { CommandPalette } = await import("@/components/CommandPalette");
const { MobileMenuSheet } = await import("@/components/mobile/MobileMenuSheet");

let root: Root;
let container: HTMLDivElement;
let pageKeys: string[];
const onWindowKey = (e: KeyboardEvent) => pageKeys.push(e.key);

async function frames(n = 3) {
  for (let i = 0; i < n; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): boolean {
  const ev = new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true, ...init });
  act(() => { el.dispatchEvent(ev); });
  return ev.defaultPrevented;
}

/**
 * A page with an opener button and the modal, open state held in the host —
 * as DesktopShell holds it — so closing really unmounts the modal and focus
 * restoration is observed on the real opener.
 */
function Host({ which }: { which: "palette" | "sheet" }) {
  const [open, setOpen] = useState(false);
  return createElement(
    Fragment,
    null,
    createElement("button", { id: "opener", onClick: () => setOpen(true) }, "Open"),
    which === "palette"
      ? open && createElement(CommandPalette, { open: true, onClose: () => setOpen(false) })
      : createElement(MobileMenuSheet, { open, onClose: () => setOpen(false), isAdmin: false, onAbout: () => {} }),
  );
}

async function openModal(which: "palette" | "sheet"): Promise<HTMLElement> {
  act(() => { root.render(createElement(Host, { which })); });
  const opener = container.querySelector<HTMLButtonElement>("#opener")!;
  opener.focus();
  act(() => { opener.click(); });
  await frames();
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error("no dialog");
  return dialog;
}

beforeEach(() => {
  pageKeys = [];
  push.mockClear();
  window.addEventListener("keydown", onWindowKey);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.removeEventListener("keydown", onWindowKey);
});

describe("Command Palette is a modal dialog", () => {
  it("has role=dialog, aria-modal and a name, and focuses its combobox on open", async () => {
    const dialog = await openModal("palette");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Command palette");
    const input = dialog.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(document.activeElement).toBe(input);
    expect(document.getElementById(input.getAttribute("aria-controls")!)?.getAttribute("role")).toBe("listbox");
  });

  it("Tab and Shift+Tab stay inside it", async () => {
    const dialog = await openModal("palette");
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    // The combobox is its only tab stop: results are options reached with
    // the arrows. Tab must not walk out into the page behind.
    expect(press(input, "Tab")).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(press(input, "Tab", { shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("ArrowDown moves aria-activedescendant through the results", async () => {
    const dialog = await openModal("palette");
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    await frames();
    const first = input.getAttribute("aria-activedescendant");
    expect(first && document.getElementById(first)?.getAttribute("role")).toBe("option");
    press(input, "ArrowDown");
    const second = input.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    expect(document.getElementById(second!)?.getAttribute("aria-selected")).toBe("true");
  });

  it("Escape closes it, never reaches the page behind, and focus returns to the opener", async () => {
    const dialog = await openModal("palette");
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    // Control: other keys typed in the palette do reach window listeners, so
    // the listener below is live and an absent Escape means something.
    press(input, "a");
    expect(pageKeys).toEqual(["a"]);

    press(input, "Escape");
    await frames();
    expect(pageKeys).toEqual(["a"]);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("#opener"));
  });
});

describe("the mobile menu sheet is a modal dialog", () => {
  it("has role=dialog, aria-modal and a name, and moves focus inside on open", async () => {
    const dialog = await openModal("sheet");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Menu");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Tab wraps from the last control to the first, Shift+Tab from the first to the last", async () => {
    const dialog = await openModal("sheet");
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.length).toBeGreaterThan(3);
    const [first, last] = [buttons[0], buttons[buttons.length - 1]];

    last.focus();
    expect(press(last, "Tab")).toBe(true);
    expect(document.activeElement).toBe(first);

    expect(press(first, "Tab", { shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(last);

    // In the middle, Tab is the browser's own move — not intercepted.
    buttons[1].focus();
    expect(press(buttons[1], "Tab")).toBe(false);
  });

  it("Escape closes it, never reaches the page behind, and focus returns to the opener", async () => {
    const dialog = await openModal("sheet");
    const inside = dialog.querySelector<HTMLButtonElement>("button")!;
    inside.focus();
    press(inside, "Escape");
    // The sheet animates out for 250ms before it reports closed.
    await act(async () => { await new Promise((r) => setTimeout(r, 320)); });
    await frames();
    expect(pageKeys).toEqual([]);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("#opener"));
  });
});
