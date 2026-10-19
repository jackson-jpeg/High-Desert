import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FUNNEL_STORAGE_KEY, resetFunnelForTests } from "@/services/stats/funnel-client";
import { FUNNEL_WAIT_MS, VISITOR_STORAGE_KEY, noteVisitor, resetVisitorForTests } from "@/services/stats/visitor-client";
import { NOT_COUNTED_KEY } from "@/services/stats/not-counted";

/**
 * The browser half of the visitor count: one id, kept; one post per page
 * load; the funnel arrival riding along so the server can match a backfilled
 * placeholder. What reaches the server is read off the real fetch calls.
 */

let posted: Record<string, unknown>[];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetFunnelForTests();
  resetVisitorForTests();
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/stats/visitor");
      posted.push(JSON.parse(String(init.body)));
      return new Response("{}");
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.look;
});

const funnelState = (s: object) => localStorage.setItem(FUNNEL_STORAGE_KEY, JSON.stringify(s));

describe("visitor count, browser side", () => {
  it("mints one id, keeps it, and posts once per page load with the funnel arrival", () => {
    funnelState({ cohort: "2026-09-27", device: "phone", done: ["visit"], looks: { visit: ["win98"] } });
    document.documentElement.dataset.look = "night";
    noteVisitor();
    noteVisitor();
    expect(posted).toHaveLength(1);
    const id = localStorage.getItem(VISITOR_STORAGE_KEY);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(posted[0]).toEqual({
      visitorId: id, device: "desktop", look: "night", cohort: "2026-09-27", cohortDevice: "phone", cohortLook: "win98",
    });

    resetVisitorForTests(); // a reload: only localStorage survives
    noteVisitor();
    expect(posted).toHaveLength(2);
    expect(posted[1].visitorId).toBe(id);
  });

  it("a browser the funnel excluded says it was here before", () => {
    funnelState({ cohort: null, done: [] });
    noteVisitor();
    expect(posted[0]).toMatchObject({ hereBefore: true });
    expect(posted[0]).not.toHaveProperty("cohort");
  });

  it("waits for the funnel's verdict, then posts with it", () => {
    noteVisitor();
    expect(posted).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(posted).toHaveLength(0);
    funnelState({ cohort: "2026-10-19", device: "phone", done: ["visit"] });
    vi.advanceTimersByTime(600);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ cohort: "2026-10-19", cohortDevice: "phone" });
  });

  it("posts without a verdict after the wait (a show page has none)", () => {
    noteVisitor();
    vi.advanceTimersByTime(FUNNEL_WAIT_MS + 600);
    expect(posted).toHaveLength(1);
    expect(posted[0]).not.toHaveProperty("cohort");
    expect(posted[0]).not.toHaveProperty("hereBefore");
  });

  it("a headless checker posts nothing, and mints nothing", () => {
    localStorage.setItem(NOT_COUNTED_KEY, "1");
    noteVisitor();
    vi.advanceTimersByTime(FUNNEL_WAIT_MS * 2);
    expect(posted).toHaveLength(0);
    expect(localStorage.getItem(VISITOR_STORAGE_KEY)).toBeNull();
  });

  it("a browser that cannot remember its id posts nothing", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    try {
      noteVisitor();
      vi.advanceTimersByTime(FUNNEL_WAIT_MS * 2);
      expect(posted).toHaveLength(0);
    } finally {
      set.mockRestore();
    }
  });

  it("an unmount mid-wait still posts this load's visit", () => {
    const cancel = noteVisitor();
    cancel();
    expect(posted).toHaveLength(1);
    vi.advanceTimersByTime(FUNNEL_WAIT_MS * 2);
    expect(posted).toHaveLength(1);
  });
});
