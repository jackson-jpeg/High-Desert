import { afterEach, describe, expect, it, vi } from "vitest";
import { onTheStation, reportPlaybackFailure } from "@/services/stats/client";
import { useLiveStore } from "@/stores/live-store";

/**
 * A failure is the station's (and counts toward its breaker) only on the
 * show on the air, in a tab tuned in to it. The same show from the library,
 * or the station ID, is not.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  useLiveStore.setState({ tuned: false, phase: "off", current: null });
});

const tuned = (episodeId: string, phase: "show" | "station-id" = "show") =>
  useLiveStore.setState({ tuned: true, phase, current: { episodeId } as never });

describe("onTheStation", () => {
  it("the station's show, tuned in", () => {
    tuned("coll--a");
    expect(onTheStation("coll--a")).toBe(true);
    expect(onTheStation("coll--b")).toBe(false);
  });
  it("not tuned, or between shows, is never the station's", () => {
    tuned("coll--a", "station-id");
    expect(onTheStation("coll--a")).toBe(false);
    useLiveStore.setState({ tuned: false, phase: "show" });
    expect(onTheStation("coll--a")).toBe(false);
  });
  it("the report carries live: true only then", () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    const f = { episodeId: "coll--a", kind: "stall" as const, retried: false, recovered: false, elapsedMs: 1, uaClass: "android-chrome" as const };
    reportPlaybackFailure(f);
    tuned("coll--a");
    reportPlaybackFailure(f);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));
    expect(bodies[0].live).toBeUndefined();
    expect(bodies[1].live).toBe(true);
  });
});
