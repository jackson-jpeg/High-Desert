import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BOOT_SCRIPT } from "../boot-script";

/**
 * Executes the exact string the root layout inlines, against a jsdom copy of
 * the boot screen's markup. A test that re-implemented dismiss() would agree
 * with itself (docs/disconnected-checks.md).
 *
 * The bug: dismiss() faded #app-loading to opacity 0 but left it hit-testable
 * until display:none 400ms later, so a tap on the visibly-revealed page landed
 * on the overlay and was lost.
 */

function mountBootScreen() {
  document.body.innerHTML = `
    <div id="app-loading">
      <div id="boot-container" style="display:none"><div data-boot="0"></div></div>
      <div id="quick-splash" style="display:none"></div>
    </div>`;
  return document.getElementById("app-loading") as HTMLElement;
}

function runBootScript() {
  new Function(BOOT_SCRIPT)();
}

describe("boot screen dismissal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("stops intercepting pointers the moment the fade starts (input dismiss)", () => {
    const el = mountBootScreen();
    runBootScript();
    expect(el.style.pointerEvents).toBe("");

    window.dispatchEvent(new Event("keydown"));

    expect(el.style.opacity).toBe("0");
    expect(el.style.pointerEvents).toBe("none");
    // Still in the tree for the fade: this is exactly the window a tap was lost in.
    expect(el.style.display).not.toBe("none");

    vi.advanceTimersByTime(400);
    expect(el.style.display).toBe("none");
  });

  it("stops intercepting pointers the moment the fade starts (timed dismiss)", () => {
    const el = mountBootScreen();
    runBootScript();

    vi.advanceTimersByTime(6000);

    expect(el.style.opacity).toBe("0");
    expect(el.style.pointerEvents).toBe("none");
    expect(el.style.display).not.toBe("none");
  });
});
