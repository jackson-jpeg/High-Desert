import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILD_META, isBuildId, pageBuild } from "@/lib/utils/build-id";
import { reportPlay, reportPlaybackFailure } from "@/services/stats/client";

/**
 * The page's build comes from its own document, and every play and failure
 * the page reports carries it. That is what lets the release line tell a row
 * written by the release from one written by a tab left open on older code.
 */

function setMeta(content: string | null) {
  document.querySelector(`meta[name="${BUILD_META}"]`)?.remove();
  if (content === null) return;
  const m = document.createElement("meta");
  m.name = BUILD_META;
  m.content = content;
  document.head.appendChild(m);
}

afterEach(() => {
  setMeta(null);
  vi.unstubAllGlobals();
});

describe("build ids", () => {
  it("accepts a short or full SHA, with a dirty-tree digest; nothing else", () => {
    for (const ok of ["1ff3416", "1ff34165ecdf1d9851be5b037515cab499a09404", "1ff3416-0a1b2c3"]) expect(isBuildId(ok)).toBe(true);
    for (const bad of ["dev", "", "1ff34", "1FF3416", "1ff3416-", "1ff3416 ", "1790578113675x", null, 7]) expect(isBuildId(bad)).toBe(false);
  });

  it("the page's build is its document's meta tag, or null", () => {
    expect(pageBuild()).toBeNull();
    setMeta("dev");
    expect(pageBuild()).toBeNull();
    setMeta("abc1234");
    expect(pageBuild()).toBe("abc1234");
  });
});

describe("rows carry the page's build", () => {
  function bodies() {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    return () => fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));
  }

  it("a play and a failure send the build the page was served as", () => {
    setMeta("abc1234");
    const sent = bodies();
    reportPlay("ep", "sessionid1234", "archive");
    reportPlaybackFailure({ episodeId: "ep", kind: "stall", retried: false, recovered: false, elapsedMs: 1, uaClass: "other" });
    expect(sent().map((b) => b.build)).toEqual(["abc1234", "abc1234"]);
  });

  it("a page that cannot say sends no build at all (stored as unknown)", () => {
    const sent = bodies();
    reportPlay("ep", "sessionid1234");
    expect("build" in sent()[0]).toBe(false);
  });
});
