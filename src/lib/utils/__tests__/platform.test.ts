import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The platform bucket that `playback_failures.ua_class` stores.
 *
 * The question the failure data exists to answer is "is this an iOS media
 * stack problem or does it happen everywhere" — and iPadOS asks for the
 * desktop site, reporting a Macintosh user agent. The only tell is touch
 * points. Without that check every iPad failure is filed as desktop Safari,
 * which is exactly the split the data is for.
 *
 * `isIOSDevice` caches its answer for the page's lifetime, so each case loads
 * a fresh copy of the module.
 */

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ in its default "desktop website" mode.
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  curl: "curl/8.5.0",
};

let standalone = false;

async function load(userAgent: string, maxTouchPoints = 0) {
  vi.resetModules();
  // jsdom's navigator has no maxTouchPoints to spy on; a stand-in with the
  // two fields the module reads.
  vi.stubGlobal("navigator", { userAgent, maxTouchPoints });
  return import("../platform");
}

beforeEach(() => {
  standalone = false;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: standalone && q.includes("standalone"), media: q }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uaClass", () => {
  it("files an iPhone as iOS Safari", async () => {
    const p = await load(UA.iphone, 5);
    expect(p.isIOSDevice()).toBe(true);
    expect(p.uaClass()).toBe("ios-safari");
  });

  it("files an iPad in desktop mode as iOS, not as desktop Safari", async () => {
    const p = await load(UA.ipadDesktopMode, 5);
    expect(p.isIOSDevice()).toBe(true);
    expect(p.uaClass()).toBe("ios-safari");
  });

  it("files a Mac as desktop Safari — the touch-point check is what separates it from an iPad", async () => {
    const p = await load(UA.macSafari, 0);
    expect(p.isIOSDevice()).toBe(false);
    expect(p.uaClass()).toBe("desktop-safari");
  });

  it("files an installed iOS web app as ios-pwa", async () => {
    standalone = true;
    const p = await load(UA.iphone, 5);
    expect(p.uaClass()).toBe("ios-pwa");
  });

  it("orders the desktop engines so Chrome is not Safari and Edge is Chromium", async () => {
    expect((await load(UA.android, 5)).uaClass()).toBe("android-chrome");
    expect((await load(UA.firefox)).uaClass()).toBe("desktop-firefox");
    expect((await load(UA.chrome)).uaClass()).toBe("desktop-chromium");
    expect((await load(UA.edge)).uaClass()).toBe("desktop-chromium");
    expect((await load(UA.curl)).uaClass()).toBe("other");
  });
});
