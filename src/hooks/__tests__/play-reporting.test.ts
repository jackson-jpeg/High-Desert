import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";

/**
 * A listen must be reported however it was started.
 *
 * There are two start paths and only one of them used to report anything.
 * `playEpisode()` is the obvious one — clicking a row in the library, the queue
 * advancing, the radio dial locking on — and it calls `reportPlay`. The other
 * appeared when `primeEpisode()` began pointing the element at the restored
 * episode on page load: with a `src` already set, `togglePlay()` stopped
 * routing through `hd:play-episode` and started playing the element in place,
 * which never goes near `playEpisode`.
 *
 * So playback worked and nothing was recorded. No leaderboard entry, no
 * permanent play event, and no `active_sessions.episode_id` — which is why the
 * show you were listening to was missing from "on air" while you were, plainly,
 * listening to it. The fix that made the restored player work is the same
 * change that stopped it counting.
 *
 * This mounts the real hook rather than mirroring its logic, because the defect
 * was a missing call site: a test that re-implements togglePlay would have
 * reproduced the omission and passed.
 */

// React 19 refuses to run act() without this, and warns on every render.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const reportPlay = vi.fn<(episodeId: string, sessionId: string) => void>();
const updateEpisode =
  vi.fn<(id: number, changes: Record<string, unknown>) => Promise<number>>(
    () => Promise.resolve(1),
  );

let element: HTMLAudioElement;

vi.mock("@/services/stats/client", () => ({
  reportPlay: (episodeId: string, sessionId: string) =>
    reportPlay(episodeId, sessionId),
  reportStop: vi.fn(),
  reportStopBeacon: vi.fn(),
  reportPlaybackFailure: vi.fn(),
}));

vi.mock("@/audio/engine", () => ({
  getMediaElement: () => element,
  initEngine: vi.fn(),
  setEngineVolume: vi.fn(),
  notifySourceChanged: vi.fn(),
  getAnalyserNode: () => null,
  resumeContext: () => Promise.resolve(),
}));

vi.mock("@/db", () => ({
  db: {
    episodes: {
      update: (id: number, changes: Record<string, unknown>) =>
        updateEpisode(id, changes),
    },
    userPrefs: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
  },
}));

vi.mock("@/services/archive/health", () => ({
  checkArchiveHealth: () => Promise.resolve({ ok: true }),
  clearHealthCache: vi.fn(),
}));

// The watchdog owns retry policy and is covered by its own suite. Here it only
// needs to answer isWatching(), which is what distinguishes "this is the first
// play of a primed element" from "this is an ordinary pause/resume".
let watching = false;
vi.mock("@/audio/playback-watchdog", () => ({
  armWatchdog: vi.fn(() => {
    watching = true;
  }),
  disarmWatchdog: vi.fn(() => {
    watching = false;
  }),
  isWatching: () => watching,
  noteError: vi.fn(),
  noteProgress: vi.fn(),
  noteReady: vi.fn(),
  noteUnplayable: vi.fn(),
  noteWaiting: vi.fn(),
  setFailureHandler: vi.fn(),
}));

const { useAudioPlayer } = await import("@/hooks/useAudioPlayer");
const { usePlayerStore } = await import("@/stores/player-store");

/**
 * Distinct per test. The play-count de-duplication window is keyed on the
 * community key and lives in module state that outlives a single test, so two
 * tests sharing an episode would have the second one suppressed — a false pass
 * in the exact test written to catch a missing report.
 */
let episodeSeq = 0;

function makeEpisode(over: Partial<Episode> = {}): Episode {
  episodeSeq += 1;
  return {
    id: 7,
    fileHash: `archive:coll:show-${episodeSeq}.mp3`,
    fileName: `1997-07-2${episodeSeq}_-_Coast_to_Coast_AM.mp3`,
    archiveIdentifier: "ultimate-art-bell-collection",
    title: "Coast to Coast AM — Men in Black",
    sourceUrl: "https://archive.org/download/coll/show.mp3",
    playbackPosition: 615,
    duration: 10_800,
    playCount: 3,
    showType: "coast",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Episode;
}

/** A media element jsdom will accept, with the bits it refuses to implement. */
function makeElement(): HTMLAudioElement {
  const el = document.createElement("audio");
  el.play = vi.fn(() => Promise.resolve());
  el.load = vi.fn();
  Object.defineProperty(el, "readyState", {
    value: 0,
    writable: true,
    configurable: true,
  });
  return el;
}

type Api = ReturnType<typeof useAudioPlayer>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/**
 * Mount the real hook and hand back what it returns.
 *
 * The handoff goes through an effect rather than an assignment during render:
 * writing to an outer variable mid-render is a side effect, and the lint rules
 * this repo runs are right to refuse it. Effects flush before act() returns, so
 * the sink is populated by the time this does.
 */
function mountPlayer(): Api {
  const sink: { api?: Api } = {};
  function Harness() {
    const api = useAudioPlayer();
    useEffect(() => {
      sink.api = api;
    });
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(Harness));
  });
  return sink.api!;
}

describe("a listen is reported however it was started", () => {
  beforeEach(() => {
    reportPlay.mockClear();
    updateEpisode.mockClear();
    watching = false;
    element = makeElement();
    usePlayerStore.setState({
      currentEpisode: null,
      queue: [],
      queueIndex: -1,
      playing: false,
      position: 0,
      duration: 0,
      loadState: "idle",
      error: null,
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it("reports a play started from the library", async () => {
    const api = mountPlayer();
    const ep = makeEpisode();

    await act(async () => {
      await api.playEpisode(ep);
    });

    expect(reportPlay).toHaveBeenCalledTimes(1);
    expect(reportPlay.mock.calls[0][0]).toContain("Coast_to_Coast_AM");
  });

  it("reports a play started from the restored player", async () => {
    // This is the regression. The episode is remembered from the last visit and
    // primeEpisode has pointed the element at it, so togglePlay plays it in
    // place instead of dispatching hd:play-episode. Before the fix this ran the
    // audio and reported nothing, and the show never reached the on-air list.
    const api = mountPlayer();
    const ep = makeEpisode({ id: 11 });

    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      api.primeEpisode(ep);
    });

    expect(element.src).toBe(ep.sourceUrl);
    expect(usePlayerStore.getState().playing).toBe(false);

    await act(async () => {
      await api.togglePlay();
    });

    expect(element.play).toHaveBeenCalled();
    expect(usePlayerStore.getState().playing).toBe(true);
    expect(reportPlay).toHaveBeenCalledTimes(1);
    expect(reportPlay.mock.calls[0][0]).toContain("Coast_to_Coast_AM");
    // The local counter is the same call site, and was equally missing.
    expect(updateEpisode).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ playCount: 4 }),
    );
  });

  it("does not count a pause and resume as a second listen", async () => {
    // Mid-show, the element is loaded and the watchdog has stood down. Resuming
    // is the same listen continuing — counting it would inflate the leaderboard
    // every time somebody paused to answer the door.
    const api = mountPlayer();
    const ep = makeEpisode({ id: 12 });

    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      usePlayerStore.setState({ playing: true });
    });
    element.src = ep.sourceUrl!;
    Object.defineProperty(element, "readyState", {
      value: 4, // HAVE_ENOUGH_DATA
      writable: true,
      configurable: true,
    });

    await act(async () => {
      await api.togglePlay(); // pause
    });
    await act(async () => {
      await api.togglePlay(); // resume
    });

    expect(element.play).toHaveBeenCalled();
    expect(reportPlay).not.toHaveBeenCalled();
  });
});
