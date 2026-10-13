import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { LiveChatSheet } from "@/components/live/LiveChatSheet";

/**
 * The Phone Lines sheet opened with a focus box around Close (2026-10-13):
 * the trap focused the first button, and a page reached without a pointer
 * (a link, the URL /live?lines=1) draws a ring on programmatic focus. Focus
 * now lands on the sheet itself, so nothing is ringed until a key is pressed,
 * and the first Tab still reaches Close. The control is the same trap without
 * the option, which still focuses the first button, as every other modal does.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

async function frames(n = 3) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

function press(el: Element, key: string) {
  const ev = new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(ev);
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the Phone Lines sheet's focus on open", () => {
  it("lands on the sheet, not on Close; the first Tab goes to Close", async () => {
    act(() => {
      root.render(
        <LiveChatSheet open onClose={() => {}}>
          <button id="inside">Call in</button>
        </LiveChatSheet>,
      );
    });
    await frames();
    const sheet = container.querySelector<HTMLElement>('[data-testid="live-chat-sheet"]')!;
    const close = container.querySelector<HTMLElement>('[aria-label="Close phone lines"]')!;
    expect(document.activeElement).toBe(sheet);
    expect(document.activeElement).not.toBe(close);
    press(sheet, "Tab");
    expect(document.activeElement).toBe(close);
  });

  it("control: the trap without focusContainer focuses the first button", async () => {
    function Plain() {
      const { ref, onKeyDown } = useFocusTrap({ active: true });
      return createElement(
        "div",
        { ref, onKeyDown, tabIndex: -1, role: "dialog", "data-testid": "plain" },
        createElement("button", { id: "first" }, "First"),
      );
    }
    act(() => {
      root.render(createElement(Plain));
    });
    await frames();
    expect(document.activeElement?.id).toBe("first");
  });
});
