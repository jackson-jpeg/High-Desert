import { afterEach, describe, expect, it, vi } from "vitest";
import { reportPlay, reportPlaybackFailure } from "@/services/stats/client";
import { FAILURE_TAB_ID, SESSION_ID } from "@/lib/utils/session-id";

/**
 * A failure report names its tab, so one tab pressing Try Again 33 times is
 * one lost start on the release line, not 33 (LOST_START_GAP_MINUTES,
 * src/services/stats/db/failures.ts). The id is the tab's own: not the
 * presence session, and never sent with a play, so a failure row cannot be
 * joined to anything else about the listener.
 */

afterEach(() => vi.unstubAllGlobals());

function bodies() {
  const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
  vi.stubGlobal("fetch", fetchMock);
  return () =>
    fetchMock.mock.calls.map((c) => {
      const [url, init] = c as unknown as [string, RequestInit];
      return { url, body: init.body instanceof Blob ? null : JSON.parse(String(init.body)) };
    });
}

describe("failure reports carry the tab's own id", () => {
  it("every failure from this page carries the same tab id, in the shape the column accepts", () => {
    const sent = bodies();
    reportPlaybackFailure({ episodeId: "ep", kind: "decode-error", retried: false, recovered: false, elapsedMs: 1, uaClass: "android-chrome" });
    reportPlaybackFailure({ episodeId: "ep", kind: "decode-error", retried: false, recovered: false, elapsedMs: 1, uaClass: "android-chrome" });
    const tabs = sent().map((s) => s.body.tab);
    expect(tabs).toEqual([FAILURE_TAB_ID, FAILURE_TAB_ID]);
    expect(FAILURE_TAB_ID).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("is not the presence session, and a play never sends it", () => {
    expect(FAILURE_TAB_ID).not.toBe(SESSION_ID);
    const sent = bodies();
    reportPlay("ep", SESSION_ID, "archive");
    const play = sent()[0].body;
    expect(JSON.stringify(play)).not.toContain(FAILURE_TAB_ID);
  });
});

describe("failure reports carry the page's look (2026-10-12)", () => {
  afterEach(() => {
    delete document.documentElement.dataset.look;
  });

  it("sends the look the page was rendered in, as a play does", () => {
    document.documentElement.dataset.look = "win98";
    const sent = bodies();
    reportPlaybackFailure({ episodeId: "ep", kind: "stall", retried: true, recovered: false, elapsedMs: 1, uaClass: "ios-safari" });
    expect(sent()[0].body.look).toBe("win98");
  });

  it("control: a page with no look sends none", () => {
    const sent = bodies();
    reportPlaybackFailure({ episodeId: "ep", kind: "stall", retried: true, recovered: false, elapsedMs: 1, uaClass: "ios-safari" });
    expect(sent()[0].body).not.toHaveProperty("look");
  });
});
