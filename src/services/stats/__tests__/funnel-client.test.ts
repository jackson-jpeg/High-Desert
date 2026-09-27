import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  FUNNEL_STORAGE_KEY,
  funnelDecided,
  noteFunnelStep,
  resetFunnelForTests,
  startFunnel,
} from "@/services/stats/funnel-client";

/**
 * The browser half of the arrival funnel: who counts, and that each step is
 * reported once, ever, against the day the browser first arrived. What reaches
 * the server is read off the real `fetch` calls, not off the module's state.
 */

const DAY = Date.UTC(2026, 8, 27, 15);
let posted: { step: string; cohort: string; device: string }[];

beforeEach(() => {
  localStorage.clear();
  resetFunnelForTests();
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/stats/funnel");
      expect(init.method).toBe("POST");
      posted.push(JSON.parse(String(init.body)));
      return new Response("{}");
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("funnel, browser side", () => {
  it("an empty library on arrival is a first visit, in today's UTC cohort", () => {
    startFunnel(true, DAY);
    expect(posted).toEqual([{ step: "visit", cohort: "2026-09-27", device: "desktop" }]);
    expect(funnelDecided()).toBe(true);
  });

  it("each later step is reported once, ever, against the arrival day", () => {
    startFunnel(true, DAY);
    noteFunnelStep("live");
    noteFunnelStep("live");
    noteFunnelStep("tune");
    noteFunnelStep("tune");
    noteFunnelStep("call");
    resetFunnelForTests(); // a reload: only localStorage survives
    noteFunnelStep("tune");
    noteFunnelStep("call");
    expect(posted).toEqual([
      { step: "visit", cohort: "2026-09-27", device: "desktop" },
      { step: "live", cohort: "2026-09-27", device: "desktop" },
      { step: "tune", cohort: "2026-09-27", device: "desktop" },
      { step: "call", cohort: "2026-09-27", device: "desktop" },
    ]);
  });

  it("a verdict is kept: a second arrival verdict is ignored, the cohort does not move", () => {
    startFunnel(true, DAY);
    startFunnel(true, DAY + 3 * 86_400_000);
    noteFunnelStep("live");
    expect(posted).toEqual([
      { step: "visit", cohort: "2026-09-27", device: "desktop" },
      { step: "live", cohort: "2026-09-27", device: "desktop" },
    ]);
  });

  it("a browser that already had a library is never counted, not even its later steps", () => {
    startFunnel(false, DAY);
    noteFunnelStep("live");
    noteFunnelStep("tune");
    startFunnel(true, DAY);
    noteFunnelStep("call");
    expect(posted).toEqual([]);
    expect(funnelDecided()).toBe(true);
  });

  it("steps before the verdict wait for it: reported after the visit, or dropped", () => {
    noteFunnelStep("live");
    noteFunnelStep("tune");
    expect(posted).toEqual([]);
    startFunnel(true, DAY);
    expect(posted.map((p) => p.step)).toEqual(["visit", "live", "tune"]);

    localStorage.clear();
    resetFunnelForTests();
    posted = [];
    noteFunnelStep("live");
    startFunnel(false, DAY);
    expect(posted).toEqual([]);
  });

  it("a browser that cannot remember having counted never counts", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    try {
      startFunnel(true, DAY);
      startFunnel(true, DAY);
      noteFunnelStep("live");
      expect(posted).toEqual([]);
    } finally {
      setItem.mockRestore();
    }
  });

  it("a later step that cannot be remembered is not reported, however often it happens", () => {
    startFunnel(true, DAY);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    try {
      noteFunnelStep("live");
      noteFunnelStep("live");
      expect(posted.map((p) => p.step)).toEqual(["visit"]);
    } finally {
      setItem.mockRestore();
    }
  });

  it("a phone is a phone for the whole funnel, whatever the window does later", () => {
    const narrow = vi.fn((q: string) => ({ matches: q !== "(min-width: 768px)" }) as MediaQueryList);
    vi.stubGlobal("matchMedia", narrow);
    startFunnel(true, DAY);
    expect(narrow).toHaveBeenCalledWith("(min-width: 768px)");
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true }) as MediaQueryList)); // rotated, or a wider window
    resetFunnelForTests();
    noteFunnelStep("live");
    expect(posted).toEqual([
      { step: "visit", cohort: "2026-09-27", device: "phone" },
      { step: "live", cohort: "2026-09-27", device: "phone" },
    ]);
  });

  it("an unreadable state is treated as excluded, not as a new arrival", () => {
    localStorage.setItem(FUNNEL_STORAGE_KEY, "{not json");
    startFunnel(true, DAY);
    noteFunnelStep("live");
    expect(posted).toEqual([]);
  });
});
