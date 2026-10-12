import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ARRIVAL_KEY,
  heartbeatUsage,
  reportView,
  takeArrival,
  viewPayload,
} from "@/services/stats/usage-client";
import { NOT_COUNTED_KEY } from "@/services/stats/not-counted";
import { reportHeartbeat } from "@/services/stats/client";
import { resetFunnelForTests, startFunnel } from "@/services/stats/funnel-client";

/**
 * Usage tracking, browser side (docs/usage-tracking.md): what is sent, read
 * off the real `fetch` calls, and what is never sent.
 */

let sent: { url: string; body: Record<string, unknown> }[];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetFunnelForTests();
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}");
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("the arrival", () => {
  it("is taken once per browser session, classed, with the landing tab", () => {
    expect(takeArrival("/live", "https://old.reddit.com/r/artbell", "", "highdesert.space")).toEqual({
      source: "reddit",
      landing: "live",
    });
    expect(takeArrival("/library", "https://www.google.com/", "", "highdesert.space")).toBeNull();
    sessionStorage.clear(); // a new browser session
    expect(takeArrival("/", "", "", "highdesert.space")).toEqual({ source: "direct", landing: "welcome" });
  });

  it("is not taken at all when the session cannot remember having taken it", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      expect(takeArrival("/live", "https://chatgpt.com/", "", "highdesert.space")).toBeNull();
      expect(takeArrival("/live", "https://chatgpt.com/", "", "highdesert.space")).toBeNull();
    } finally {
      set.mockRestore();
    }
    expect(sessionStorage.getItem(ARRIVAL_KEY)).toBeNull();
  });
});

describe("a view", () => {
  it("posts the tab, the device and the arrival class, and nothing that identifies anyone", () => {
    const arrival = takeArrival("/show/1997-06-18", "https://www.reddit.com/r/x/comments/y?ref=secret", "?utm_source=abc", "highdesert.space");
    reportView(viewPayload("/show/1997-06-18", arrival, "phone"));
    expect(sent).toEqual([
      {
        url: "/api/stats/view",
        body: { route: "show", device: "phone", arrival: { source: "reddit", landing: "show" } },
      },
    ]);
    const raw = JSON.stringify(sent);
    expect(raw).not.toContain("reddit.com");
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("1997-06-18");
  });

  it("carries no arrival once the session's is taken", () => {
    reportView(viewPayload("/radio", null, "desktop"));
    expect(sent[0].body).toEqual({ route: "radio", device: "desktop" });
  });

  it("is not sent from a not-counted browser", () => {
    localStorage.setItem(NOT_COUNTED_KEY, "1");
    reportView(viewPayload("/library", null, "desktop"));
    expect(sent).toEqual([]);
  });
});

describe("the minute heartbeat", () => {
  it("carries the tab, the device and whether the page is on screen", () => {
    expect(heartbeatUsage("/stats", true)).toEqual({ route: "stats", device: "desktop", visible: true });
    expect(heartbeatUsage("/live", false)).toEqual({ route: "live", device: "desktop", visible: false });
    reportHeartbeat("session-abcdefgh", null, false, heartbeatUsage("/stats", true));
    expect(sent[0].body).toEqual({ sessionId: "session-abcdefgh", route: "stats", device: "desktop", visible: true });
  });

  it("carries none of it from a not-counted browser, and the beat itself still goes", () => {
    localStorage.setItem(NOT_COUNTED_KEY, "1");
    expect(heartbeatUsage("/stats", true)).toBeNull();
    reportHeartbeat("session-abcdefgh", null, false, heartbeatUsage("/stats", true));
    expect(sent[0].body).toEqual({ sessionId: "session-abcdefgh" });
  });
});

describe("the funnel honours the same mark", () => {
  it("a not-counted browser reports no funnel step", () => {
    localStorage.setItem(NOT_COUNTED_KEY, "1");
    startFunnel(true, Date.UTC(2026, 9, 12, 12));
    expect(sent).toEqual([]);
  });

  it("control: without the mark the same arrival is reported", () => {
    startFunnel(true, Date.UTC(2026, 9, 12, 12));
    expect(sent.map((s) => s.url)).toEqual(["/api/stats/funnel"]);
  });
});
