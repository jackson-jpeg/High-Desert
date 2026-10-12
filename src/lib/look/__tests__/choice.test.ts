import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chooseLook,
  dismissNightOffer,
  hasLookCookie,
  LOOK_CHOSEN_KEY,
  LOOK_OFFER_KEY,
  markNightOffered,
  pageLook,
  shouldOfferNight,
} from "../choice";
import { reportPlay } from "@/services/stats/client";
import { takeArrival } from "@/services/stats/usage-client";

/**
 * Choosing a look (src/lib/look/choice.ts): the cookie the server renders by,
 * the one-time offer's rules, and the look every arrival and play carries.
 * What leaves the page is read off the real `fetch` bodies.
 */

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  delete document.documentElement.dataset.look;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the page's look", () => {
  it("is <html data-look>, and null when the page does not say", () => {
    expect(pageLook()).toBeNull();
    document.documentElement.dataset.look = "night";
    expect(pageLook()).toBe("night");
    document.documentElement.dataset.look = "clean";
    expect(pageLook()).toBeNull();
  });
});

describe("chooseLook", () => {
  it("writes the cookie the server renders by, remembers the choice, and reloads", () => {
    const setCookie = vi.fn();
    const reload = vi.fn();
    chooseLook("night", { setCookie, secure: true, reload });
    expect(setCookie).toHaveBeenCalledWith("hd_look=night; Path=/; Max-Age=34560000; SameSite=Lax; Secure");
    expect(localStorage.getItem(LOOK_CHOSEN_KEY)).toBe("night");
    expect(reload).toHaveBeenCalledTimes(1);
    // A browser that has chosen is never offered.
    expect(shouldOfferNight("win98", "")).toBe(false);
  });

  it("reloads into the choice even where storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const setCookie = vi.fn();
    const reload = vi.fn();
    chooseLook("win98", { setCookie, secure: false, reload });
    expect(setCookie).toHaveBeenCalledWith("hd_look=win98; Path=/; Max-Age=34560000; SameSite=Lax");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("the first-visit Night offer", () => {
  it("is for a Win98 page in a browser that has never chosen and never been offered", () => {
    expect(shouldOfferNight("win98", "")).toBe(true);
    expect(shouldOfferNight("win98", "other=1")).toBe(true);
  });

  it("is never for Night, a browser with a look cookie, or one that has chosen", () => {
    expect(shouldOfferNight("night", "")).toBe(false);
    expect(shouldOfferNight("win98", "a=1; hd_look=win98")).toBe(false);
    expect(shouldOfferNight("win98", "hd_look=night")).toBe(false);
    localStorage.setItem(LOOK_CHOSEN_KEY, "win98");
    expect(shouldOfferNight("win98", "")).toBe(false);
  });

  it("shows once: offered, or dismissed, it never comes back", () => {
    expect(markNightOffered()).toBe(true);
    expect(shouldOfferNight("win98", "")).toBe(false);
    localStorage.clear();
    dismissNightOffer();
    expect(localStorage.getItem(LOOK_OFFER_KEY)).toBe("dismissed");
    expect(shouldOfferNight("win98", "")).toBe(false);
  });

  it("cannot be marked where storage is blocked, so the caller does not show it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(markNightOffered()).toBe(false);
  });

  it("only a cookie named hd_look is a choice", () => {
    expect(hasLookCookie("hd_look=night")).toBe(true);
    expect(hasLookCookie("x=1; hd_look=")).toBe(true);
    expect(hasLookCookie("hd_look_view=night")).toBe(false);
    expect(hasLookCookie("not_hd_look=1")).toBe(false);
  });
});

describe("arrivals and plays carry the look", () => {
  function bodies() {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    return () => fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));
  }

  it("a play sends the page's look, and none when the page cannot say", () => {
    const sent = bodies();
    document.documentElement.dataset.look = "night";
    reportPlay("ep", "sessionid1234");
    delete document.documentElement.dataset.look;
    reportPlay("ep", "sessionid1234");
    expect(sent()[0].look).toBe("night");
    expect("look" in sent()[1]).toBe(false);
  });

  it("an arrival carries the look it landed in", () => {
    document.documentElement.dataset.look = "win98";
    expect(takeArrival("/live", "", "", "highdesert.space")).toEqual({ source: "direct", landing: "live", look: "win98" });
  });
});
