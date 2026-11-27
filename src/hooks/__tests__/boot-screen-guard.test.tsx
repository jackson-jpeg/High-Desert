import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { BOOT_SCRIPT } from "@/app/boot-script";
import { useBootScreenGuard } from "@/hooks/useBootScreenGuard";
import { useLibraryView, LIBRARY_VIEW_KEY } from "@/hooks/library/useLibraryView";

/**
 * 2026-11-27: a reload of the Library after using the Dial sat under the boot
 * screen for good. The view hook read sessionStorage during render, so the
 * client's first render (Dial) differed from the server's (List): React
 * error #418, the whole document rendered again, and a fresh #app-loading
 * nothing would dismiss, because the boot script dismisses once.
 *
 * Both halves of the fix run for real here: the exact boot script string the
 * layout inlines, and the real hooks mounted by React.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function bootMarkup(): string {
  return `<div id="app-loading"><div id="boot-container" style="display:none"><div data-boot="0"></div></div><div id="quick-splash" style="display:none"></div></div>`;
}

function Guard() {
  useBootScreenGuard();
  return null;
}

async function mount(el: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(el));
  return root;
}

describe("a boot screen drawn again after the boot script dismissed it", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    delete window.__hdBootDismissed;
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    delete window.__hdBootDismissed;
  });

  it("is hidden by the app once the script has dismissed the first one", async () => {
    document.body.innerHTML = bootMarkup();
    new Function(BOOT_SCRIPT)();
    window.dispatchEvent(new Event("keydown")); // any input dismisses
    vi.advanceTimersByTime(400);
    expect(document.getElementById("app-loading")!.style.display).toBe("none");
    expect(window.__hdBootDismissed).toBe(true);

    // What React's recovery does: the root layout's markup, drawn again.
    document.getElementById("app-loading")!.remove();
    document.body.insertAdjacentHTML("afterbegin", bootMarkup());
    const again = document.getElementById("app-loading")!;
    expect(again.style.display).toBe("");

    vi.useRealTimers();
    const root = await mount(createElement(Guard));
    expect(again.style.display).toBe("none");
    expect(again.style.pointerEvents).toBe("none");
    act(() => root.unmount());
  });

  it("control: before the script has dismissed (the first visit's boot sequence), it is left alone", async () => {
    document.body.innerHTML = bootMarkup();
    new Function(BOOT_SCRIPT)();
    const el = document.getElementById("app-loading")!;
    vi.useRealTimers();
    const root = await mount(createElement(Guard));
    expect(window.__hdBootDismissed).toBeUndefined();
    expect(el.style.display).toBe("");
    act(() => root.unmount());
  });
});

describe("the Library's List / Dial mode renders as the server did first", () => {
  afterEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  it("a tab that last used the Dial renders List first, then the Dial after mount", async () => {
    sessionStorage.setItem(LIBRARY_VIEW_KEY, "dial");
    const seen: string[] = [];
    function Probe() {
      seen.push(useLibraryView().view);
      return null;
    }
    const root = await mount(createElement(Probe));
    expect(seen[0]).toBe("list");
    expect(seen.at(-1)).toBe("dial");
    act(() => root.unmount());
  });

  it("control: a tab with no stored mode stays on List", async () => {
    const seen: string[] = [];
    function Probe() {
      seen.push(useLibraryView().view);
      return null;
    }
    const root = await mount(createElement(Probe));
    expect(new Set(seen)).toEqual(new Set(["list"]));
    act(() => root.unmount());
  });
});
