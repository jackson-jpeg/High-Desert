import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_MS,
  RELOADED_FOR,
  RESUME_FRESH_MS,
  RESUME_MARK,
  canResumeAfterReload,
  createStaleTab,
  naturalBreak,
  type TabState,
} from "@/services/build/stale-tab";

/**
 * A tab left open reloads onto the live build at a natural break, never
 * mid-audio, keeps the listener's place, and never loops.
 */

const QUIET: TabState = {
  playing: false,
  liveTuned: false,
  livePaused: false,
  livePhase: "off",
  hidden: false,
  idleMs: 0,
  typing: false,
  canResumeAfterReload: true,
};
const ON_AIR: TabState = { ...QUIET, playing: true, liveTuned: true, livePhase: "show" };

afterEach(() => sessionStorage.clear());

describe("naturalBreak", () => {
  it("never mid-audio: a show playing, on the station or off it, hidden or not", () => {
    expect(naturalBreak(ON_AIR)).toBeNull();
    expect(naturalBreak({ ...ON_AIR, hidden: true, idleMs: IDLE_MS * 10 })).toBeNull();
    expect(naturalBreak({ ...QUIET, playing: true, hidden: true, idleMs: IDLE_MS * 10 })).toBeNull();
  });

  it("with sound on, only the station's gap between shows, on screen, where the new page may start sound", () => {
    const gap = { ...ON_AIR, livePhase: "station-id" as const };
    expect(naturalBreak(gap)).toBe("station-break");
    expect(naturalBreak({ ...gap, hidden: true })).toBeNull();
    expect(naturalBreak({ ...gap, canResumeAfterReload: false })).toBeNull();
    expect(naturalBreak({ ...gap, livePaused: true })).toBeNull();
    expect(naturalBreak({ ...gap, liveTuned: false })).toBeNull();
  });

  it("with nothing playing: hidden, or idle long enough", () => {
    expect(naturalBreak({ ...QUIET, hidden: true })).toBe("hidden");
    expect(naturalBreak({ ...QUIET, idleMs: IDLE_MS })).toBe("idle");
    expect(naturalBreak({ ...QUIET, idleMs: IDLE_MS - 1 })).toBeNull();
    expect(naturalBreak({ ...QUIET, liveTuned: true, livePaused: true, hidden: true })).toBe("hidden");
  });

  it("never while someone is typing", () => {
    expect(naturalBreak({ ...QUIET, typing: true, hidden: true })).toBeNull();
    expect(naturalBreak({ ...ON_AIR, livePhase: "station-id", typing: true })).toBeNull();
  });
});

function harness(over: { live?: string | null; mine?: string | null; tabState?: TabState } = {}) {
  let t = 1_000_000;
  let state = over.tabState ?? QUIET;
  let live = over.live === undefined ? "bbbbbbb" : over.live;
  const reload = vi.fn();
  const resumeStation = vi.fn();
  const tab = createStaleTab({
    fetchBuild: () => Promise.resolve(live),
    pageBuild: () => (over.mine === undefined ? "aaaaaaa" : over.mine),
    state: () => state,
    reload,
    resumeStation,
    onChange: () => () => {},
    now: () => t,
  });
  return {
    tab,
    reload,
    resumeStation,
    setState: (s: TabState) => (state = s),
    setLive: (b: string | null) => (live = b),
    advance: (ms: number) => (t += ms),
  };
}

describe("createStaleTab", () => {
  it("the same build is not pending, and nothing reloads", async () => {
    const h = harness({ live: "aaaaaaa", tabState: { ...QUIET, hidden: true } });
    await h.tab.check();
    expect(h.tab.pending()).toBeNull();
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("a newer build waits for a break, then reloads once, writing where the listener was", async () => {
    const h = harness({ tabState: ON_AIR });
    await h.tab.check();
    expect(h.tab.pending()).toBe("bbbbbbb");
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.tab.consider()).toBe(false);

    h.setState({ ...ON_AIR, livePhase: "station-id" });
    expect(h.tab.consider()).toBe(true);
    expect(h.reload).toHaveBeenCalledTimes(1);
    const intent = JSON.parse(sessionStorage.getItem(RESUME_MARK)!);
    expect(intent).toMatchObject({ build: "bbbbbbb", live: true, reason: "station-break" });
    expect(sessionStorage.getItem(RELOADED_FOR)).toBe("bbbbbbb");

    expect(h.tab.consider()).toBe(false);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("the idle break opens with time, and input closes it again", async () => {
    const h = harness();
    await h.tab.check();
    expect(h.reload).not.toHaveBeenCalled();
    h.advance(IDLE_MS - 1000);
    h.tab.touch();
    h.advance(IDLE_MS - 1000);
    expect(h.tab.consider()).toBe(false);
    h.advance(1000);
    expect(h.tab.consider()).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(RESUME_MARK)!)).toMatchObject({ live: false, reason: "idle" });
  });

  it("never loops: a page that comes back still not on the build it reloaded for stays put", async () => {
    sessionStorage.setItem(RELOADED_FOR, "bbbbbbb");
    const h = harness({ tabState: { ...QUIET, hidden: true } });
    await h.tab.check();
    expect(h.tab.pending()).toBeNull();
    expect(h.reload).not.toHaveBeenCalled();

    // control: a build after that one is still taken
    h.setLive("ccccccc");
    await h.tab.check();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("a page that cannot name its build, or an unreadable answer, never reloads", async () => {
    for (const h of [harness({ mine: null, tabState: { ...QUIET, hidden: true } }), harness({ live: "dev", tabState: { ...QUIET, hidden: true } }), harness({ live: null, tabState: { ...QUIET, hidden: true } })]) {
      await h.tab.check();
      expect(h.reload).not.toHaveBeenCalled();
    }
  });

  it("a failed fetch is not a newer build", async () => {
    const reload = vi.fn();
    const tab = createStaleTab({
      fetchBuild: () => Promise.reject(new Error("offline")),
      pageBuild: () => "aaaaaaa",
      state: () => ({ ...QUIET, hidden: true }),
      reload,
      resumeStation: vi.fn(),
      onChange: () => () => {},
    });
    await tab.check();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("arrive", () => {
  it("puts the station back on the air after a reload that left it there", () => {
    const h = harness();
    sessionStorage.setItem(RESUME_MARK, JSON.stringify({ build: "bbbbbbb", live: true, reason: "station-break", at: 1_000_000 - 5000 }));
    expect(h.tab.arrive()).toMatchObject({ live: true });
    expect(h.resumeStation).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RESUME_MARK)).toBeNull();
  });

  it("does not start the station for a reload that was not on the air, a stale intent, or none", () => {
    const h = harness();
    sessionStorage.setItem(RESUME_MARK, JSON.stringify({ build: "b", live: false, reason: "idle", at: 1_000_000 }));
    expect(h.tab.arrive()).toMatchObject({ live: false });
    sessionStorage.setItem(RESUME_MARK, JSON.stringify({ build: "b", live: true, reason: "station-break", at: 1_000_000 - RESUME_FRESH_MS - 1 }));
    expect(h.tab.arrive()).toBeNull();
    sessionStorage.setItem(RESUME_MARK, "{not json");
    expect(h.tab.arrive()).toBeNull();
    expect(h.tab.arrive()).toBeNull();
    expect(h.resumeStation).not.toHaveBeenCalled();
  });
});

describe("canResumeAfterReload", () => {
  const nav = (brands: string[] | null, active: boolean | null) =>
    ({
      ...(brands ? { userAgentData: { brands: brands.map((brand) => ({ brand })) } } : {}),
      ...(active === null ? {} : { userActivation: { hasBeenActive: active } }),
    }) as unknown as Navigator;

  it("only a Chromium engine that has had a tap", () => {
    expect(canResumeAfterReload(nav(["Chromium", "Google Chrome"], true))).toBe(true);
    expect(canResumeAfterReload(nav(["Chromium"], false))).toBe(false);
    expect(canResumeAfterReload(nav(null, true))).toBe(false); // Safari, Firefox
    expect(canResumeAfterReload(nav(["Chromium"], null))).toBe(false);
  });
});
