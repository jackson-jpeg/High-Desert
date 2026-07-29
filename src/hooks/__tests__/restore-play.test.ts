import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import type { Episode } from "@/db/schema";
import {
  mountHook,
  makeMediaElement,
  type Mounted,
} from "./support/mount-player";

/**
 * The bug this file exists to prevent.
 *
 * Leaving the site and coming back restored the last-played episode by calling
 * `loadEpisode(ep, "")` — a pure Zustand setter that never touches the media
 * element. So the player rendered with a live ▶ button over an `<audio>` whose
 * `src` was still empty, and `togglePlay` returned at its `if (!audio.src)`
 * guard. No sound, no error, no console log, nothing.
 *
 * A listener hit this repeatedly, worked around it by picking a different show
 * from the library (which goes through `playEpisode` and does set `src`), and
 * concluded the fault was theirs: "could very well be user error on my end
 * too." It wasn't.
 *
 * Two invariants, then:
 *   1. Restoring an episode leaves the element pointed at something playable.
 *   2. Pressing play with no source loaded must never be a silent no-op.
 *
 * This used to assert both against a local `primeEpisode` and an inlined copy of
 * `togglePlay`'s no-source branch, on the grounds that mounting the real hook
 * would mean rendering the whole desktop layout. That was not true — it needs a
 * two-line harness — and the cost of the shortcut was exactly what you would
 * expect: the copy fell behind the original, which had since gained a
 * `notifySourceChanged()` call and a `playbackRate` assignment. The suite was
 * green and testing nothing. It mounts the real hook now.
 */

const notifySourceChanged = vi.fn();

let element: HTMLAudioElement;

vi.mock("@/services/stats/client", () => ({
  reportPlay: vi.fn(),
  reportStop: vi.fn(),
  reportStopBeacon: vi.fn(),
  reportPlaybackFailure: vi.fn(),
}));

vi.mock("@/audio/engine", () => ({
  getMediaElement: () => element,
  initEngine: vi.fn(),
  setEngineVolume: vi.fn(),
  notifySourceChanged: () => notifySourceChanged(),
  getAnalyserNode: () => null,
  resumeContext: () => Promise.resolve(),
}));

vi.mock("@/db", () => ({
  db: {
    episodes: { update: () => Promise.resolve(1) },
    userPrefs: {
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(),
    },
  },
}));

vi.mock("@/services/archive/health", () => ({
  checkArchiveHealth: () => Promise.resolve({ ok: true, up: true }),
  clearHealthCache: vi.fn(),
}));

const { useAudioPlayer } = await import("@/hooks/useAudioPlayer");
const { usePlayerStore } = await import("@/stores/player-store");

function makeEpisode(over: Partial<Episode> = {}): Episode {
  return {
    id: 7,
    fileHash: "archive:coll:show.mp3",
    fileName: "show.mp3",
    title: "Coast to Coast AM — Area 51",
    sourceUrl: "https://archive.org/download/coll/show.mp3",
    playbackPosition: 615,
    duration: 10_800,
    showType: "coast",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Episode;
}

type Api = ReturnType<typeof useAudioPlayer>;
let player: Mounted<Api>;

describe("restoring the last-played episode", () => {
  beforeEach(() => {
    notifySourceChanged.mockClear();
    element = makeMediaElement();
    usePlayerStore.setState({
      currentEpisode: null,
      queue: [],
      queueIndex: -1,
      playing: false,
      position: 0,
      duration: 0,
      playbackRate: 1,
      loadState: "idle",
      error: null,
    });
    player = mountHook(useAudioPlayer);
  });

  afterEach(() => {
    player.unmount();
  });

  it("points the element at the episode, so play has something to resume", () => {
    const ep = makeEpisode();

    // What the layout's restore effect does.
    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      usePlayerStore.getState().setPosition(ep.playbackPosition ?? 0);
      usePlayerStore.getState().setDuration(ep.duration ?? 0);
      player.api.primeEpisode(ep);
    });

    expect(element.src).toBe(ep.sourceUrl);
    expect(element.currentTime).toBe(615);
  });

  it("costs no network — a restored episode nobody plays must not be fetched", () => {
    act(() => {
      player.api.primeEpisode(makeEpisode());
    });
    // "metadata" would have every page load pull the head of a show nobody
    // asked for; on a VBR rip with no Xing header that can be most of the file.
    expect(element.preload).toBe("none");
  });

  it("tells the engine the source changed", () => {
    // The assertion the hand-written copy was missing. It is a no-op in the
    // engine today (createMediaElementSource survives a src change), which is
    // precisely why nobody noticed the copy had dropped it — and why the call
    // needs a test rather than a reader's good intentions.
    act(() => {
      player.api.primeEpisode(makeEpisode());
    });
    expect(notifySourceChanged).toHaveBeenCalledTimes(1);
  });

  it("carries the listener's playback rate onto the restored element", () => {
    // Also missing from the copy. Someone who listens at 1.5× and comes back
    // should not be dropped to 1× by the act of being remembered.
    act(() => {
      usePlayerStore.setState({ playbackRate: 1.5 });
      player.api.primeEpisode(makeEpisode());
    });
    expect(element.playbackRate).toBe(1.5);
  });

  it("does not auto-play — restoring is not starting", () => {
    const ep = makeEpisode();
    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      player.api.primeEpisode(ep);
    });
    expect(usePlayerStore.getState().playing).toBe(false);
  });

  it("never stomps a source that is already loaded", () => {
    element.src = "https://archive.org/download/coll/already-playing.mp3";

    act(() => {
      player.api.primeEpisode(makeEpisode());
    });

    expect(element.src).toContain("already-playing");
  });

  it("leaves the element alone for an episode with no source", () => {
    act(() => {
      player.api.primeEpisode(makeEpisode({ sourceUrl: undefined }));
    });
    expect(element.getAttribute("src")).toBeNull();
  });

  it("pressing play with no source asks for the episode instead of doing nothing", async () => {
    const ep = makeEpisode();
    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
    });

    const dispatched: Episode[] = [];
    const listener = (e: Event) =>
      dispatched.push((e as CustomEvent<Episode>).detail);
    window.addEventListener("hd:play-episode", listener);

    // No primeEpisode: the element has no src. The old code was a bare `return`.
    await act(async () => {
      await player.api.togglePlay();
    });

    window.removeEventListener("hd:play-episode", listener);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].id).toBe(ep.id);
  });
});

describe("loadEpisode clears stale playback state", () => {
  it("resets buffering, which used to latch on forever after a failure", () => {
    usePlayerStore.setState({
      buffering: true,
      bufferedTo: 300,
      error: "Network error. Check your connection.",
      queue: [],
      queueIndex: -1,
    });

    usePlayerStore.getState().loadEpisode(makeEpisode({ id: 9 }), "");

    const s = usePlayerStore.getState();
    expect(s.buffering).toBe(false);
    expect(s.bufferedTo).toBe(0);
    expect(s.error).toBeNull();
  });
});
