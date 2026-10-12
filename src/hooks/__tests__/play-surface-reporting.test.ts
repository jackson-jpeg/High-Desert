import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import type { Episode } from "@/db/schema";
import { mountHook, makeMediaElement, type Mounted } from "./support/mount-player";

/**
 * Where a play was started reaches `reportPlay` as its `surface`, on both
 * start paths (docs/usage-tracking.md, src/audio/play-surface.ts). The real
 * hook, the real start token and the real bus: the surface is bound to the
 * start, so a test that re-implemented the binding would prove nothing.
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

const { beginStart } = await import("@/audio/play-session");
const { bindPlaySurface, resetPlaySurfaceForTests, retryWithPlaySurface, withPlaySurface } = await import("@/audio/play-surface");
const { setLiveStart } = await import("@/audio/live-session");
const { emit, onHdEvent } = await import("@/lib/events");

const surfaces = () => reportPlay.mock.calls.map((c) => c[3]);

/** What the layout's play-episode handler does: take the token, bind, play. */
function listen(api: Api): () => void {
  return onHdEvent("play-episode", (ep) => {
    const start = beginStart();
    bindPlaySurface(start);
    void api.playEpisode(ep, undefined, start);
  });
}

const at = (path: string) => window.history.replaceState({}, "", path);

describe("a play's surface", () => {
  let off: (() => void) | null = null;

  beforeEach(() => {
    reportPlay.mockClear();
    useProgressStore.getState().reset();
    resetPlaySurfaceForTests();
    setLiveStart(null);
    watching = false;
    element = makeElement();
    usePlayerStore.setState({ currentEpisode: null, queue: [], queueIndex: -1, playing: false, loadState: "idle", error: null });
    at("/library");
  });

  afterEach(() => {
    off?.();
    off = null;
    player?.unmount();
    setLiveStart(null);
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("is the tab the listener was on, for an ordinary start", async () => {
    const api = mountPlayer();
    at("/radio");
    await act(async () => {
      await api.playEpisode(makeEpisode());
    });
    at("/stats");
    await act(async () => {
      await api.playEpisode(makeEpisode());
    });
    expect(surfaces()).toEqual(["radio", "stats"]);
  });

  it("is what the emitter declared, through the bus and the start token", async () => {
    const api = mountPlayer();
    off = listen(api);
    act(() => withPlaySurface("palette", () => emit("play-episode", makeEpisode())));
    await flush();
    expect(surfaces()).toEqual(["palette"]);
  });

  it("is queue for a queue advance, whatever tab is open", async () => {
    const api = mountPlayer();
    off = listen(api);
    at("/stats");
    act(() => usePlayerStore.getState().playTrack(makeEpisode()));
    await flush();
    expect(surfaces()).toEqual(["queue"]);
  });

  it("does not outlive its start: the next undeclared start is the tab's", async () => {
    const api = mountPlayer();
    off = listen(api);
    act(() => withPlaySurface("queue", () => emit("play-episode", makeEpisode())));
    await flush();
    at("/radio");
    act(() => emit("play-episode", makeEpisode()));
    await flush();
    // A start that never passes through a binding (playEpisode taking its own
    // token) must not inherit the last one's either.
    at("/stats");
    act(() => withPlaySurface("palette", () => emit("play-episode", makeEpisode())));
    await flush();
    await act(async () => {
      await api.playEpisode(makeEpisode());
    });
    expect(surfaces()).toEqual(["queue", "radio", "palette", "stats"]);
  });

  it("is restore for the remembered show's first ▶ (the togglePlay path)", async () => {
    const api = mountPlayer();
    const ep = makeEpisode({ id: 31 });
    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      api.primeEpisode(ep);
    });
    await act(async () => {
      await api.togglePlay();
    });
    expect(surfaces()).toEqual(["restore"]);
  });

  it("a Try Again keeps the surface of the start it retries", async () => {
    const api = mountPlayer();
    off = listen(api);
    act(() => withPlaySurface("queue", () => emit("play-episode", makeEpisode())));
    await flush();
    reportPlay.mockClear();
    at("/radio");
    // A different show, so the retry is not de-duplicated as the same listen.
    act(() => retryWithPlaySurface(() => emit("play-episode", makeEpisode())));
    await flush();
    expect(surfaces()).toEqual(["queue"]);
  });

  it("is live for the station's airing, whoever started it", async () => {
    const api = mountPlayer();
    const ep = makeEpisode();
    setLiveStart({ fileHash: ep.fileHash, slotKey: `${Date.now()}:${ep.fileHash}`, startAt: () => 60 });
    await act(async () => {
      await api.playEpisode(ep);
    });
    expect(surfaces()).toEqual(["live"]);
  });
});

describe("the layout's play-episode handler binds the declared surface", () => {
  // The handler is the one place every bus start takes its token. Mounting the
  // whole desktop layout is out of reach here, so the call is held in its
  // source, next to the token it binds (the suite above proves what binding
  // does once it happens).
  it("binds right after it takes the start token", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(path.resolve(__dirname, "../../app/[look]/(desktop)/layout.tsx"), "utf8");
    expect(src).toMatch(/const start = beginStart\(\);\n(\s*\/\/[^\n]*\n)*\s*bindPlaySurface\(start\);/);
  });
});
