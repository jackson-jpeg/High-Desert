import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import type { Episode } from "@/db/schema";
import { mountHook, makeMediaElement, type Mounted } from "./support/mount-player";

/**
 * A shared moment's start (docs/show-pages.md, "Sharing"): "Open in High
 * Desert" asks for the next start of a show to begin at `t`
 * (src/audio/requested-start.ts), and the real `playEpisode()` starts there,
 * once, before the saved position and after the live station.
 */

const reportPlay = vi.fn<(episodeId: string, sessionId: string, source?: unknown, surface?: unknown) => void>();
const updateEpisode =
  vi.fn<(id: number, changes: Record<string, unknown>) => Promise<number>>(
    () => Promise.resolve(1),
  );
/** The `progress` table (HD-016): where "last played" is recorded. */
const upsertProgress =
  vi.fn<(fileHash: string, changes: Record<string, unknown>) => Promise<boolean>>(
    () => Promise.resolve(true),
  );

let element: HTMLAudioElement;

vi.mock("@/services/stats/client", () => ({
  reportPlay: (episodeId: string, sessionId: string, source?: unknown, surface?: unknown) =>
    reportPlay(episodeId, sessionId, source, surface),
  reportStop: vi.fn(),
  reportStopBeacon: vi.fn(),
  reportPlaybackFailure: vi.fn(),
}));

// The real seekEngine/pauseEngine, bound to this suite's element: seeking is
// what HD-004/HD-024 changed, so it must be the production code under test.
vi.mock("@/audio/engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/audio/engine")>();
  const bound = () => real.initEngine(element);
  return {
  // The live station bridge (engine.ts): never on in these suites.
  isBridging: () => false,
  playBridge: () => Promise.resolve(),
  endBridge: () => {},
  stopBridge: () => {},
  getMediaElement: () => element,
  initEngine: vi.fn(),
  setEngineVolume: vi.fn(),
  getAnalyserNode: () => null,
  resumeContext: () => Promise.resolve(),
    seekEngine: (t: number) => {
      bound();
      return real.seekEngine(t);
    },
    pauseEngine: () => {
      bound();
      real.pauseEngine();
    },
  };
});

vi.mock("@/db", () => ({
  db: {
    episodes: {
      update: (id: number, changes: Record<string, unknown>) =>
        updateEpisode(id, changes),
    },
    progress: {
      upsert: (fileHash: string, changes: Record<string, unknown>) =>
        upsertProgress(fileHash, changes),
    },
    userPrefs: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
  },
}));

const clearHealthCache = vi.fn();

vi.mock("@/services/archive/health", () => ({
  checkArchiveHealth: () => Promise.resolve({ ok: true }),
  clearHealthCache: () => clearHealthCache(),
  archiveKnownDown: () => false,
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
  setFailoverHandler: vi.fn(),
}));

const { useAudioPlayer } = await import("@/hooks/useAudioPlayer");
const { usePlayerStore } = await import("@/stores/player-store");
const { useProgressStore } = await import("@/stores/progress-store");

/**
 * Distinct per test. The play-count de-duplication window is keyed on the
 * community key and lives in module state that outlives a single test, so two
 * tests sharing an episode would have the second one suppressed — a false pass
 * in the exact test written to catch a missing report.
 */
let episodeSeq = 0;

/** `playbackPosition` goes to the progress mirror (HD-016), by fileHash. */
function makeEpisode(over: Partial<Episode> & { playbackPosition?: number } = {}): Episode {
  const { playbackPosition = 615, ...fields } = over;
  episodeSeq += 1;
  const ep = {
    id: 7,
    fileHash: `archive:coll:show-${episodeSeq}.mp3`,
    fileName: `1997-07-2${episodeSeq}_-_Coast_to_Coast_AM.mp3`,
    archiveIdentifier: "ultimate-art-bell-collection",
    title: "Coast to Coast AM — Men in Black",
    sourceUrl: "https://archive.org/download/coll/show.mp3",
    duration: 10_800,
    playCount: 3,
    showType: "coast",
    createdAt: 0,
    updatedAt: 0,
    ...fields,
  } as Episode;
  useProgressStore.getState().patch(ep.fileHash, { playbackPosition });
  return ep;
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

const { requestStartAt, resetRequestedStartForTests, peekRequestedStart } = await import("@/audio/requested-start");
const { setLiveStart } = await import("@/audio/live-session");

describe("a requested start (a shared moment)", () => {
  beforeEach(() => {
    useProgressStore.getState().reset();
    resetRequestedStartForTests();
    setLiveStart(null);
    watching = false;
    element = makeElement();
    usePlayerStore.setState({ currentEpisode: null, queue: [], queueIndex: -1, playing: false, loadState: "idle", error: null });
  });

  afterEach(() => {
    player?.unmount();
    setLiveStart(null);
    resetRequestedStartForTests();
  });

  async function play(api: Api, ep: Episode) {
    await act(async () => {
      await api.playEpisode(ep);
    });
  }

  it("starts the show at the requested second instead of the saved position, once", async () => {
    const api = mountPlayer();
    const ep = makeEpisode({ playbackPosition: 615 });
    requestStartAt(ep.fileHash, 5025);
    await play(api, ep);
    expect(element.currentTime).toBe(5025);
    expect(peekRequestedStart()).toBeNull();
    // The next start of the same show is an ordinary one: the saved position.
    element = makeElement();
    await play(api, ep);
    expect(element.currentTime).toBe(615);
  });

  it("is kept for its own show: another show starts as it would have", async () => {
    const api = mountPlayer();
    const mine = makeEpisode({ playbackPosition: 0 });
    const other = makeEpisode({ playbackPosition: 615 });
    requestStartAt(mine.fileHash, 300);
    await play(api, other);
    expect(element.currentTime).toBe(615);
    expect(peekRequestedStart()).toEqual({ fileHash: mine.fileHash, at: 300 });
  });

  it("gives way to the live station, which owns the playhead", async () => {
    const api = mountPlayer();
    const ep = makeEpisode({ playbackPosition: 0 });
    requestStartAt(ep.fileHash, 300);
    setLiveStart({ fileHash: ep.fileHash, slotKey: `${Date.now()}:${ep.fileHash}`, startAt: () => 60 });
    await play(api, ep);
    expect(element.currentTime).toBe(60);
  });

  it("a moment past the end of the show is no moment: the show starts as usual", async () => {
    const api = mountPlayer();
    const ep = makeEpisode({ playbackPosition: 615 });
    requestStartAt(ep.fileHash, 20_000);
    await play(api, ep);
    expect(element.currentTime).toBe(615);
  });
});
