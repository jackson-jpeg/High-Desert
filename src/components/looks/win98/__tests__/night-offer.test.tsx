import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Look } from "@/lib/look/look";

/**
 * The one-time "Prefer dark? Switch to Night" offer: Win98 only, a browser that
 * has never chosen and never been offered, after the boot screen, never over
 * a phone's Live screen until it has tuned in. Seen, dismissed or accepted, it
 * never shows again. Storage is real (jsdom's localStorage); the switch
 * itself is chooseLook's (choice.test.ts), replaced here by a spy.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const chosen = vi.hoisted(() => vi.fn());
vi.mock("@/lib/look/choice", async () => {
  const actual = await vi.importActual<typeof import("@/lib/look/choice")>("@/lib/look/choice");
  return { ...actual, chooseLook: chosen };
});
const env = vi.hoisted(() => ({ pathname: "/library", mobile: false }));
vi.mock("next/navigation", () => ({ usePathname: () => env.pathname }));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => env.mobile, useMediaQuery: () => false }));

const { NightOffer, BOOT_POLL_MS } = await import("../NightOffer");
const { LookProvider } = await import("@/hooks/useLook");
const { useLiveStore } = await import("@/stores/live-store");
const { LOOK_OFFER_KEY } = await import("@/lib/look/choice");

let root: Root;
let host: HTMLDivElement;

function mount(look: Look = "win98") {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(LookProvider, { look }, createElement(NightOffer, { bottomPx: 100 }))));
}
const offer = () => document.querySelector<HTMLElement>('[data-testid="night-offer"]');
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

beforeEach(() => {
  localStorage.clear();
  chosen.mockClear();
  env.pathname = "/library";
  env.mobile = false;
  useLiveStore.setState({ tuned: false });
  document.cookie = "hd_look=; Max-Age=0; Path=/";
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.getElementById("app-loading")?.remove();
  vi.restoreAllMocks();
});

describe("the first-visit Night offer", () => {
  it("shows once on a first Win98 visit, and is remembered as shown before it shows", () => {
    mount();
    expect(offer()).not.toBeNull();
    expect(offer()!.textContent).toContain("Prefer dark?");
    expect(localStorage.getItem(LOOK_OFFER_KEY)).toBe("shown");
    act(() => root.unmount());
    host.remove();
    mount();
    expect(offer()).toBeNull();
  });

  it("Switch to Night switches", () => {
    mount();
    act(() => document.querySelector<HTMLElement>('[data-testid="night-offer-accept"]')!.click());
    expect(chosen).toHaveBeenCalledWith("night");
  });

  it("dismissing hides it for good", () => {
    mount();
    const close = document.querySelector<HTMLElement>('[data-testid="night-offer-dismiss"]')!;
    expect(close.getAttribute("aria-label")).toBe("No thanks");
    act(() => close.click());
    expect(offer()).toBeNull();
    expect(localStorage.getItem(LOOK_OFFER_KEY)).toBe("dismissed");
    expect(chosen).not.toHaveBeenCalled();
  });

  it("Escape inside it dismisses it", () => {
    mount();
    act(() => {
      offer()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(offer()).toBeNull();
  });

  it("never in Night, never with a look cookie, never after a choice", () => {
    mount("night");
    expect(offer()).toBeNull();
    act(() => root.unmount());
    host.remove();
    document.cookie = "hd_look=win98; Path=/";
    mount();
    expect(offer()).toBeNull();
    act(() => root.unmount());
    host.remove();
    document.cookie = "hd_look=; Max-Age=0; Path=/";
    localStorage.setItem("hd-look-chosen", "win98");
    mount();
    expect(offer()).toBeNull();
  });

  it("waits for the boot screen to go", async () => {
    const boot = document.createElement("div");
    boot.id = "app-loading";
    document.body.appendChild(boot);
    mount();
    await wait(BOOT_POLL_MS * 2);
    expect(offer()).toBeNull();
    expect(localStorage.getItem(LOOK_OFFER_KEY)).toBeNull();
    boot.style.opacity = "0";
    await wait(BOOT_POLL_MS * 2);
    expect(offer()).not.toBeNull();
  });

  it("on a phone's Live screen it waits until the listener has tuned in", () => {
    env.mobile = true;
    env.pathname = "/live";
    mount();
    expect(offer()).toBeNull();
    expect(localStorage.getItem(LOOK_OFFER_KEY)).toBeNull();
    act(() => useLiveStore.setState({ tuned: true }));
    expect(offer()).not.toBeNull();
  });

  it("a desktop's Live screen is no reason to wait", () => {
    env.pathname = "/live";
    mount();
    expect(offer()).not.toBeNull();
  });

  it("a browser that cannot remember it never sees it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    mount();
    expect(offer()).toBeNull();
  });

  it("uses no em dash, and its buttons are touch-sized on a phone", () => {
    env.mobile = true;
    mount();
    expect(offer()!.textContent).not.toContain("—");
    for (const b of offer()!.querySelectorAll("button")) expect(b.className).toContain("min-h-touch");
  });
});
