import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Whatever moves this tab in or out of the live count is said at once, not at
 * the next 60 s beat. It used to beat only when `tuned` changed — so pausing
 * (which now holds the station, still tuned) and resuming moved the count a
 * minute late, and leaving from a held station not at all until then.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const beats = vi.hoisted(() => [] as (boolean | undefined)[]);
vi.mock("@/services/stats/client", () => ({
  reportHeartbeat: (_s: string, _e: string | null, live?: boolean) => {
    beats.push(live);
    return Promise.resolve();
  },
}));
vi.mock("@/services/stats/now-feed", () => ({ refreshNow: vi.fn() }));
vi.mock("@/hooks/useCommunityNow", () => ({
  useCommunityNow: () => ({ online: 0, listening: 0, poll: 0 }),
}));

const { usePresence } = await import("@/hooks/usePresence");
const { useLiveStore } = await import("@/stores/live-store");
const { usePlayerStore } = await import("@/stores/player-store");

function Probe() {
  usePresence();
  return null;
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  beats.length = 0;
  useLiveStore.setState({ tuned: false, paused: false, phase: "off", current: null });
  usePlayerStore.setState({ playing: false, currentEpisode: null });
  host = document.createElement("div");
  root = createRoot(host);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
});

describe("the heartbeat follows the live count", () => {
  it("beats when playing the station starts, when a pause holds it, on resume, and on leaving", () => {
    expect(beats).toEqual([false]);
    act(() => useLiveStore.setState({ tuned: true, phase: "show" }));
    // Tuned but not yet sounding: not live, so nothing to say yet.
    expect(beats).toEqual([false]);
    act(() => usePlayerStore.setState({ playing: true }));
    expect(beats).toEqual([false, true]);
    act(() => {
      usePlayerStore.setState({ playing: false });
      useLiveStore.setState({ paused: true });
    });
    expect(beats).toEqual([false, true, false]);
    act(() => {
      useLiveStore.setState({ paused: false });
      usePlayerStore.setState({ playing: true });
    });
    expect(beats).toEqual([false, true, false, true]);
    act(() => useLiveStore.getState().setTuned(false));
    expect(beats).toEqual([false, true, false, true, false]);
  });

  it("does not beat on changes that leave the count where it was", () => {
    act(() => usePlayerStore.setState({ playing: true }));
    act(() => usePlayerStore.setState({ position: 42 }));
    act(() => useLiveStore.setState({ drift: 0.5 }));
    expect(beats).toEqual([false]);
  });
});
