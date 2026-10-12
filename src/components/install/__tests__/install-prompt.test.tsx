import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The home-screen prompt, mounted: what it shows on a second visit in each
 * kind of browser, and that Not now and Install are respected. The rules
 * themselves: src/services/install/__tests__/install-prompt.test.ts.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { InstallPrompt } = await import("@/components/install/InstallPrompt");
const { captureInstallPrompt, resetInstallPromptForTests, VISITS_KEY, INSTALL_KEY, dayOf } = await import(
  "@/services/install/install-prompt"
);

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

let root: Root;
let host: HTMLDivElement;
let standalone = false;
const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function setUa(ua: string, touch: number) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  // jsdom has no maxTouchPoints at all.
  Object.defineProperty(navigator, "maxTouchPoints", { value: touch, configurable: true });
}

/** A visit already counted earlier today in another session: this page load is the second. */
function secondVisit() {
  localStorage.setItem(VISITS_KEY, JSON.stringify({ n: 1, day: dayOf(new Date()) }));
}

async function mount() {
  await act(async () => root.render(<InstallPrompt />));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetInstallPromptForTests();
  standalone = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("standalone") ? standalone : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InstallPrompt", () => {
  it("first visit: nothing", async () => {
    setUa(IPHONE, 5);
    await mount();
    expect(q("install-prompt")).toBeNull();
  });

  it("iPhone Safari, second visit: the two steps, with the Share icon, and Not now holds", async () => {
    setUa(IPHONE, 5);
    secondVisit();
    await mount();
    expect(q("install-prompt")!.dataset.mode).toBe("ios");
    expect(q("install-ios-steps")!.textContent).toBe("Install: tap Share , then Add to Home Screen.");
    expect(q("install-share-icon")).not.toBeNull();
    expect(q("install-button")).toBeNull();
    expect(host.textContent).not.toMatch(/—/);
    act(() => q("install-dismiss")!.click());
    expect(q("install-prompt")).toBeNull();
    expect(JSON.parse(localStorage.getItem(INSTALL_KEY)!).dismissals).toBe(1);
    // Next time, still away.
    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    expect(q("install-prompt")).toBeNull();
  });

  it("a browser with an install event, second visit: Install calls the browser's own prompt", async () => {
    setUa(DESKTOP, 0);
    secondVisit();
    const release = captureInstallPrompt();
    const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: vi.fn(async () => ({ outcome: "accepted", platform: "web" })),
    });
    window.dispatchEvent(e);
    await mount();
    expect(q("install-prompt")!.dataset.mode).toBe("install");
    await act(async () => q("install-button")!.click());
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(q("install-prompt")).toBeNull();
    release();
  });

  it("the same browser without the event (not installable here): nothing", async () => {
    setUa(DESKTOP, 0);
    secondVisit();
    await mount();
    expect(q("install-prompt")).toBeNull();
  });

  it("already installed: nothing, even on iPhone", async () => {
    setUa(IPHONE, 5);
    secondVisit();
    standalone = true;
    await mount();
    expect(q("install-prompt")).toBeNull();
  });
});
