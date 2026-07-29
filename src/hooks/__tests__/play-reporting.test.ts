import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import type { Episode } from "@/db/schema";
import {
  mountHook,
  makeMediaElement,
  setReadyState,
  type Mounted,
} from "./support/mount-player";

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

const clearHealthCache = vi.fn();

vi.mock("@/services/archive/health", () => ({
  checkArchiveHealth: () => Promise.resolve({ ok: true }),
  clearHealthCache: () => clearHealthCache(),
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
  noteListenersAttached: vi.fn(),
  noteListenersDetached: vi.fn(),
  noteProgress: vi.fn(),
  noteReady: vi.fn(),
  noteSuspectDuration: vi.fn(),
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
  return makeMediaElement(vi.fn(() => Promise.resolve()));
}

type Api = ReturnType<typeof useAudioPlayer>;

let player: Mounted<Api>;

function mountPlayer(): Api {
  player = mountHook(useAudioPlayer);
  return player.api;
}

describe("a listen is reported however it was started", () => {
  beforeEach(() => {
    reportPlay.mockClear();
    updateEpisode.mockClear();
    clearHealthCache.mockClear();
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
    player?.unmount();
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

  it("gives the restored player every side effect the library path gets", async () => {
    // The play report was the one that mattered, but it went missing because
    // the whole start-of-listen block did — one side effect at a time, silently,
    // as playEpisode accumulated them and this path did not. These are the rest:
    // a stale failure banner outliving the decision to play, a cached
    // archive.org outage verdict about to be re-tested by a real request, and
    // queue context. Asserted here so the two paths cannot drift again.
    const api = mountPlayer();
    const ep = makeEpisode({ id: 21 });

    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      api.primeEpisode(ep);
      // Left over from a previous show that failed.
      usePlayerStore.setState({ error: "Playback failed.", queueIndex: -1 });
    });
    clearHealthCache.mockClear();

    await act(async () => {
      await api.togglePlay();
    });

    const s = usePlayerStore.getState();
    expect(s.error).toBeNull();
    expect(clearHealthCache).toHaveBeenCalled();
    expect(s.currentEpisode?.id).toBe(21);
    expect(s.queueIndex).toBeGreaterThanOrEqual(0);
    expect(s.queue[s.queueIndex].id).toBe(21);
    expect(s.loadState).toBe("loading");
  });

  it("does not throw away a seek when the listen is already current", async () => {
    // openListen re-establishes queue context, and loadEpisode resets position
    // from the episode record. Running it against the episode already playing
    // would silently rewind the listener to where the row says they were.
    const api = mountPlayer();
    const ep = makeEpisode({ id: 22, playbackPosition: 100 });

    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      api.primeEpisode(ep);
      usePlayerStore.getState().setPosition(4200); // scrubbed forward
    });

    await act(async () => {
      await api.togglePlay();
    });

    expect(usePlayerStore.getState().position).toBe(4200);
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
    setReadyState(element, 4); // HAVE_ENOUGH_DATA

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
