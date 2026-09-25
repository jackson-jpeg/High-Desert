import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePaletteShortcut } from "@/hooks/usePaletteShortcut";

/**
 * HD-040: Ctrl/Cmd+K, through the real listener DesktopShell installs. With
 * Caps Lock on, `e.key` is "K", and the handler compared against "k" only.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const toggle = vi.fn();
function Probe() {
  usePaletteShortcut(toggle);
  return null;
}

let root: Root;
function mount() {
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(createElement(Probe)));
}

afterEach(() => {
  act(() => root.unmount());
  toggle.mockReset();
});

function press(init: KeyboardEventInit) {
  const e = new KeyboardEvent("keydown", { cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe("usePaletteShortcut", () => {
  it("Ctrl+K and Cmd+K toggle the palette", () => {
    mount();
    expect(press({ key: "k", ctrlKey: true }).defaultPrevented).toBe(true);
    press({ key: "k", metaKey: true });
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it("works with Caps Lock on (or Shift held): e.key is 'K'", () => {
    mount();
    const e = press({ key: "K", ctrlKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("ignores K without a modifier, and other keys with one", () => {
    mount();
    press({ key: "k" });
    press({ key: "K" });
    press({ key: "j", ctrlKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", () => {
    mount();
    act(() => root.unmount());
    press({ key: "k", ctrlKey: true });
    expect(toggle).not.toHaveBeenCalled();
    mount(); // for afterEach
  });
});
