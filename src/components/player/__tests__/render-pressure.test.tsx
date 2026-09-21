import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";

/**
 * HD-017: the player must not re-render on position ticks.
 *
 * The store writes `position` every 250 ms for as long as a show plays. When
 * AudioPlayer selected it, every tick re-rendered the whole player — cassette,
 * oscilloscope, queue, controls — to move one thumb and one clock. The
 * subscription now lives in PositionReadouts.tsx's leaves.
 *
 * AudioPlayer's renders are counted through its one call to useAudioPlayer(),
 * which is mocked for exactly that reason (and because the real hook would
 * create an audio element). The leaves are real, and the test checks the clock
 * on screen actually moved — a player that stopped re-rendering by no longer
 * showing the position would otherwise pass.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const hookCalls = vi.fn();

vi.mock("@/hooks/useAudioPlayer", () => ({
  useAudioPlayer: () => {
    hookCalls();
    return {
      togglePlay: vi.fn(),
      seek: vi.fn(),
      stopPlayback: vi.fn(),
      playNext: vi.fn(),
      playPrevious: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useMediaQuery: () => false,
}));
vi.mock("@/hooks/useLoadingHint", () => ({ useLoadingHint: () => null }));
// Canvas and requestAnimationFrame; not what is under test.
vi.mock("@/components/player/Oscilloscope", () => ({ Oscilloscope: () => null }));

const { AudioPlayer } = await import("@/components/player/AudioPlayer");
const { usePlayerStore } = await import("@/stores/player-store");
const { formatTime } = await import("@/lib/utils/format");

let root: Root;
let container: HTMLDivElement;

const episode = {
  id: 1,
  fileHash: "archive:coll:rp.mp3",
  fileName: "1997-03-13 - Coast to Coast AM.mp3",
  title: "Coast to Coast AM",
  sourceUrl: "https://archive.org/download/coll/rp.mp3",
  duration: 10_800,
  showType: "coast",
  createdAt: 0,
  updatedAt: 0,
} as Episode;

beforeEach(() => {
  usePlayerStore.setState({
    currentEpisode: episode,
    duration: 10_800,
    position: 0,
    playing: true,
    mini: false,
    error: null,
    loadState: "playing",
    queue: [episode],
    queueIndex: 0,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(AudioPlayer));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AudioPlayer under playback", () => {
  it("does not re-render on position ticks, while the clock on screen still moves", () => {
    const rendersBefore = hookCalls.mock.calls.length;
    expect(rendersBefore).toBeGreaterThan(0);

    // Twenty ticks: five seconds of playback.
    for (let i = 1; i <= 20; i++) {
      act(() => {
        usePlayerStore.getState().setPosition(600 + i * 0.25);
      });
    }

    expect(hookCalls.mock.calls.length).toBe(rendersBefore);
    expect(container.textContent).toContain(formatTime(605));
  });

  it("still re-renders for things it does show", () => {
    const rendersBefore = hookCalls.mock.calls.length;
    act(() => {
      usePlayerStore.setState({ playing: false });
    });
    expect(hookCalls.mock.calls.length).toBeGreaterThan(rendersBefore);
  });
});
