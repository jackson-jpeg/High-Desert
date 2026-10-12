import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTypedWord } from "@/hooks/useTypedWord";

/**
 * Night's way into Mel's Hole: "hole" typed on a keyboard with nothing
 * focused (DesktopShell). Never a held key's repeats, never into a field.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const onWord = vi.fn();

function Probe({ enabled }: { enabled: boolean }) {
  useTypedWord("hole", onWord, enabled);
  return null;
}

function mount(enabled = true) {
  act(() => root.render(createElement(Probe, { enabled })));
}

function type(text: string, target: EventTarget = window, init: KeyboardEventInit = {}) {
  for (const key of text) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    });
  }
}

beforeEach(() => {
  onWord.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useTypedWord", () => {
  it("control: typing the word with nothing focused calls it once", () => {
    mount();
    type("hole");
    expect(onWord).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled (Win98 has its own)", () => {
    mount(false);
    type("hole");
    expect(onWord).not.toHaveBeenCalled();
  });

  it("ignores a held key's repeats", () => {
    mount();
    type("hol");
    type("e", window, { repeat: true });
    expect(onWord).not.toHaveBeenCalled();
  });

  it("ignores typing into a field", () => {
    mount();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    type("hole", input);
    input.remove();
    expect(onWord).not.toHaveBeenCalled();
  });
});
