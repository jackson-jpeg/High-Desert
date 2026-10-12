import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";

/**
 * The Winamp window is a view, not a second player: every control calls the
 * functions AudioPlayer hands it (from useAudioPlayer) or the store's own
 * actions, the speed button respects the live station's lock, and, like
 * AudioPlayer (HD-017), the window does not re-render on position ticks.
 *
 * Renders of the window are counted through MirrorBadge, which it draws once
 * per render in the details panel; the LED clock is real, and the test checks
 * it moved, so a window that stopped showing the position cannot pass.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const windowRenders = vi.fn();
const openLibrary = vi.fn();

vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => false, useMediaQuery: () => false }));
vi.mock("@/hooks/useLoadingHint", () => ({ useLoadingHint: () => null }));
vi.mock("@/hooks/useOpenLibraryIntent", () => ({ useOpenLibraryIntent: () => openLibrary }));
vi.mock("@/components/player/Oscilloscope", () => ({ Oscilloscope: () => null }));
vi.mock("@/components/player/MirrorBadge", () => ({
  MirrorBadge: () => {
    windowRenders();
    return null;
  },
}));
vi.mock("@/components/player/SleepTimer", () => ({ SleepTimer: () => null }));
vi.mock("@/components/player/BookmarkMarkers", () => ({ BookmarkMarkers: () => null }));
vi.mock("@/components/player/QueuePanel", () => ({ QueuePanel: () => createElement("div", { "data-testid": "queue-panel" }) }));

const { WinampPlayer } = await import("../WinampPlayer");
const { usePlayerStore } = await import("@/stores/player-store");
const { useLiveStore, LIVE_LOCKED_MESSAGE } = await import("@/stores/live-store");
const { useToastStore } = await import("@/stores/toast-store");

const episode = {
  id: 1,
  fileHash: "archive:coll:w.mp3",
  fileName: "1997-03-13 - Coast to Coast AM.mp3",
  title: "Coast to Coast AM",
  sourceUrl: "https://archive.org/download/coll/w.mp3",
  duration: 10_800,
  showType: "coast",
  createdAt: 0,
  updatedAt: 0,
} as Episode;
const next = { ...episode, id: 2, fileHash: "archive:coll:w2.mp3" } as Episode;

let root: Root;
let container: HTMLDivElement;
type Fn<A extends unknown[] = []> = ReturnType<typeof vi.fn<(...args: A) => void>>;
let controls: { togglePlay: Fn; seek: Fn<[number]>; stopPlayback: Fn; playNext: Fn; playPrevious: Fn };

const byId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const click = (id: string) => act(() => byId(id).click());

beforeEach(() => {
  windowRenders.mockClear();
  openLibrary.mockClear();
  controls = {
    togglePlay: vi.fn<() => void>(),
    seek: vi.fn<(s: number) => void>(),
    stopPlayback: vi.fn<() => void>(),
    playNext: vi.fn<() => void>(),
    playPrevious: vi.fn<() => void>(),
  };
  useLiveStore.setState({ tuned: false, paused: false });
  usePlayerStore.setState({
    currentEpisode: episode,
    duration: 10_800,
    position: 0,
    playing: true,
    mini: false,
    error: null,
    loadState: "playing",
    queue: [next, episode, next],
    queueIndex: 1,
    playbackRate: 1,
    shuffle: false,
    repeat: "off",
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(WinampPlayer, { controls })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the Winamp window's controls", () => {
  it("calls the same functions AudioPlayer's controls do", () => {
    click("w98-amp-play");
    expect(controls.togglePlay).toHaveBeenCalledTimes(1);
    click("w98-amp-stop");
    expect(controls.stopPlayback).toHaveBeenCalledTimes(1);
    click("w98-amp-next");
    expect(controls.playNext).toHaveBeenCalledTimes(1);
    click("w98-amp-prev");
    expect(controls.playPrevious).toHaveBeenCalledTimes(1);
  });

  it("uses the store's own actions for shuffle, repeat and speed", () => {
    click("w98-amp-shuffle");
    expect(usePlayerStore.getState().shuffle).toBe(true);
    click("w98-amp-repeat");
    expect(usePlayerStore.getState().repeat).not.toBe("off");
    click("w98-amp-speed");
    expect(usePlayerStore.getState().playbackRate).toBe(1.25);
  });

  it("refuses a change of speed while tuned in to the station", () => {
    useLiveStore.setState({ tuned: true, paused: false });
    click("w98-amp-speed");
    expect(usePlayerStore.getState().playbackRate).toBe(1);
    expect(useToastStore.getState().toasts.some((t) => t.message === LIVE_LOCKED_MESSAGE)).toBe(true);
  });

  it("opens the playlist editor from PL, and Eject opens the library at the show", () => {
    expect(container.querySelector('[data-testid="w98-amp-playlist"]')).toBeNull();
    click("w98-amp-pl");
    expect(byId("w98-amp-playlist")).not.toBeNull();
    expect(byId("queue-panel")).not.toBeNull();
    click("w98-amp-eject");
    expect(openLibrary).toHaveBeenCalledWith({ scroll: "current" });
  });

  it("seeks through the passed seek function", () => {
    const range = container.querySelector<HTMLInputElement>('[data-testid="w98-amp-seek"] input[type="range"]')!;
    expect(range).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(range, "600");
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
      range.dispatchEvent(new Event("pointerup", { bubbles: true }));
      range.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight" }));
    });
    expect(controls.seek).toHaveBeenCalled();
    expect(controls.seek.mock.calls.at(-1)![0]).toBeCloseTo(600, 0);
  });
});

describe("the Winamp window under playback", () => {
  it("does not re-render on position ticks, and its clock still moves", () => {
    const before = windowRenders.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    for (let t = 1; t <= 20; t++) {
      act(() => usePlayerStore.setState({ position: t * 6 }));
    }
    expect(windowRenders.mock.calls.length).toBe(before);
    expect(byId("w98-amp-time").textContent).toContain("02:00");
  });
});
