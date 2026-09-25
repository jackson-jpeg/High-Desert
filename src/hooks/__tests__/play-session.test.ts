import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import type { Episode } from "@/db/schema";
import { mountHook, makeMediaElement, setReadyState, type Mounted } from "./support/mount-player";
import { onHdEvent } from "@/lib/events";

/**
 * The playback correctness release: HD-003, HD-004, HD-024, HD-032, HD-033.
 *
 * Everything here runs the real hook, the real watchdog, the real player store,
 * the real play-session token and the real engine seek, against an element whose
 * load() and pause() reject pending play() promises with AbortError the way
 * browsers do (support/mount-player.ts). Only the network edges are stubbed:
 * the stats client, the database and the archive health probe.
 *
 * The watchdog is real on purpose. "No failure row, no dialog" is a claim about
 * what the watchdog decides, and a mocked one decides nothing.
 */

const reportPlay = vi.fn<(episodeId: string, sessionId: string) => void>();
const reportPlaybackFailure = vi.fn<(row: Record<string, unknown>) => void>();
const updateEpisode = vi.fn<(id: number, changes: Record<string, unknown>) => Promise<number>>(
  () => Promise.resolve(1),
);

let element: HTMLAudioElement;

vi.mock("@/services/stats/client", () => ({
  reportPlay: (id: string, s: string) => reportPlay(id, s),
  reportStop: vi.fn(),
  reportStopBeacon: vi.fn(),
  reportPlaybackFailure: (row: Record<string, unknown>) => reportPlaybackFailure(row),
}));

vi.mock("@/audio/engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/audio/engine")>();
  const bound = () => real.initEngine(element);
  return {
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
      update: (id: number, changes: Record<string, unknown>) => updateEpisode(id, changes),
    },
    userPrefs: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
  },
}));

vi.mock("@/services/archive/health", () => ({
  checkArchiveHealth: () => Promise.resolve({ up: true }),
  clearHealthCache: vi.fn(),
  archiveKnownDown: () => false,
}));

const { useAudioPlayer, POSITION_SAVE_MS } = await import("@/hooks/useAudioPlayer");
const { usePlayerStore } = await import("@/stores/player-store");
const { beginStart } = await import("@/audio/play-session");
const { disarmWatchdog } = await import("@/audio/playback-watchdog");
const { communityKey } = await import("@/lib/utils/community-key");

type Api = ReturnType<typeof useAudioPlayer>;

let seq = 0;
function makeEpisode(over: Partial<Episode> = {}): Episode {
  seq += 1;
  return {
    id: 500 + seq,
    fileHash: `archive:coll:session-${seq}.mp3`,
    fileName: `1996-01-${String(seq).padStart(2, "0")} - Coast to Coast AM.mp3`,
    archiveIdentifier: "ultimate-art-bell-collection",
    title: `Show ${seq}`,
    sourceUrl: `https://archive.org/download/coll/session-${seq}.mp3`,
    playbackPosition: 0,
    duration: 10_800,
    playCount: 0,
    showType: "coast",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Episode;
}

/** play() calls, in order, each settled by the test. */
interface PendingPlay {
  resolve: () => void;
  reject: (err: unknown) => void;
}
let plays: PendingPlay[];

function controllableElement(): HTMLAudioElement {
  plays = [];
  const el = makeMediaElement(
    () =>
      new Promise<void>((resolve, reject) => {
        plays.push({ resolve, reject });
      }),
  );
  Object.defineProperty(el, "duration", { value: NaN, writable: true, configurable: true });
  return el;
}

let player: Mounted<Api>;

function setDuration(el: HTMLAudioElement, value: number): void {
  Object.defineProperty(el, "duration", { value, writable: true, configurable: true });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  updateEpisode.mockImplementation(() => Promise.resolve(1));
  element = controllableElement();
  usePlayerStore.setState({
    currentEpisode: null,
    objectUrl: null,
    queue: [],
    queueIndex: -1,
    playing: false,
    position: 0,
    duration: 0,
    error: null,
    loadState: "idle",
    failureKind: null,
    repeat: "off",
    shuffle: false,
  });
  player = mountHook(useAudioPlayer);
});

afterEach(() => {
  player.unmount();
  disarmWatchdog();
  vi.useRealTimers();
});

const failureRows = () => reportPlaybackFailure.mock.calls.length;

describe("HD-003: a superseded start is nobody's failure", () => {
  it("starting B while A's play() is pending: no failure row, no dialog, one listen for B", async () => {
    const a = makeEpisode();
    const b = makeEpisode();

    let pA!: Promise<void>;
    act(() => {
      pA = player.api.playEpisode(a);
    });
    let pB!: Promise<void>;
    act(() => {
      // B's load() rejects A's pending play() with AbortError — as browsers do.
      pB = player.api.playEpisode(b);
    });
    await act(async () => {
      await pA;
    });
    // The `abort` event the browser queues for the replaced fetch lands after
    // B has armed the watchdog. It is not an error.
    act(() => {
      element.dispatchEvent(new Event("abort"));
    });

    plays[1].resolve();
    await act(async () => {
      await pB;
    });
    setReadyState(element, 4);
    act(() => {
      element.dispatchEvent(new Event("canplay"));
    });
    act(() => {
      vi.advanceTimersByTime(60_000); // past every watchdog deadline
    });

    expect(failureRows()).toBe(0);
    expect(usePlayerStore.getState().loadState).not.toBe("failed");
    expect(usePlayerStore.getState().error).toBeNull();
    expect(reportPlay.mock.calls.map((c) => c[0])).toEqual([communityKey(b)]);
    expect(usePlayerStore.getState().playing).toBe(true);
    expect(usePlayerStore.getState().currentEpisode?.id).toBe(b.id);
  });

  it("a superseded start's refusal does not spend a retry on the old show", async () => {
    // B has been asked for (its start is taken) but is still resolving its URL
    // when A's play() is refused. Charging that to the watchdog tore the element
    // down to retry A — a show the listener had already left.
    const a = makeEpisode();
    let pA!: Promise<void>;
    act(() => {
      pA = player.api.playEpisode(a);
    });
    beginStart(); // B's handler has begun
    plays[0].reject(new DOMException("not allowed", "NotAllowedError"));
    await act(async () => {
      await pA;
    });
    await flush();

    expect(element.play).toHaveBeenCalledTimes(1);
    expect(element.getAttribute("src")).toBe(a.sourceUrl);
    expect(usePlayerStore.getState().error).toBeNull();
  });

  it("a superseded start that succeeds late is not counted, and does not claim to be playing", async () => {
    const a = makeEpisode();
    const b = makeEpisode();
    let pA!: Promise<void>;
    act(() => {
      pA = player.api.playEpisode(a);
    });
    const startB = beginStart(); // B's handler is resolving its URL
    plays[0].resolve();
    await act(async () => {
      await pA;
    });
    expect(reportPlay).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().playing).toBe(false);

    let pB!: Promise<void>;
    act(() => {
      pB = player.api.playEpisode(b, undefined, startB);
    });
    plays[1].resolve();
    await act(async () => {
      await pB;
    });
    expect(reportPlay.mock.calls.map((c) => c[0])).toEqual([communityKey(b)]);
  });

  it("a start claimed and then superseded before playEpisode runs touches nothing", async () => {
    const a = makeEpisode();
    const stale = beginStart();
    beginStart();
    await act(async () => {
      await player.api.playEpisode(a, undefined, stale);
    });
    expect(element.getAttribute("src")).toBeNull();
    expect(element.play).not.toHaveBeenCalled();
  });

  it("pausing a show before it starts is not a failure", async () => {
    const a = makeEpisode();
    let pA!: Promise<void>;
    act(() => {
      pA = player.api.playEpisode(a);
    });
    act(() => {
      player.api.pausePlayback(); // rejects the pending play() with AbortError
    });
    await act(async () => {
      await pA;
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(usePlayerStore.getState().error).toBeNull();
    expect(usePlayerStore.getState().loadState).not.toBe("failed");
    expect(failureRows()).toBe(0);
  });
});

describe("HD-004: a finished show starts from the top", () => {
  it("starts at 0 when the saved position is three seconds from the end", async () => {
    const ep = makeEpisode({ playbackPosition: 10_797, duration: 10_800 });
    act(() => {
      void player.api.playEpisode(ep);
    });
    expect(element.currentTime).toBe(0);
    expect(usePlayerStore.getState().position).toBe(0);
  });

  it("still resumes a show that is part-way through", async () => {
    const ep = makeEpisode({ playbackPosition: 615, duration: 10_800 });
    act(() => {
      void player.api.playEpisode(ep);
    });
    expect(element.currentTime).toBe(615);
  });

  it("clears the saved position when the show ends", async () => {
    const ep = makeEpisode({ playbackPosition: 600 });
    const next = makeEpisode();
    let p!: Promise<void>;
    act(() => {
      p = player.api.playEpisode(ep);
    });
    // A queue that moves on, so the only write for `ep` at the end is the clear
    // itself — not a pause save that happens to read a reset store.
    act(() => {
      usePlayerStore.setState({ queue: [ep, next], queueIndex: 0 });
    });
    plays[0].resolve();
    await act(async () => {
      await p;
    });
    setDuration(element, 10_800);
    updateEpisode.mockClear();
    act(() => {
      usePlayerStore.getState().setPosition(10_799);
      element.dispatchEvent(new Event("ended"));
    });
    const cleared = updateEpisode.mock.calls.filter(
      ([id, c]) => id === ep.id && c.playbackPosition === 0,
    );
    expect(cleared).toHaveLength(1);
    expect(usePlayerStore.getState().position).toBe(0);
    expect(usePlayerStore.getState().currentEpisode?.playbackPosition).toBe(0);
  });
});

describe("HD-024: edge cases", () => {
  it("a seek before the element has metadata is applied on loadedmetadata", () => {
    const ep = makeEpisode({ playbackPosition: 0 });
    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      player.api.primeEpisode(ep);
    });
    expect(element.readyState).toBe(0);
    act(() => {
      player.api.seek(1200);
    });
    expect(usePlayerStore.getState().position).toBe(1200);

    // The browser's load resets the playhead; the held seek must survive it.
    element.currentTime = 0;
    setDuration(element, 10_800);
    setReadyState(element, 1);
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(element.currentTime).toBe(1200);
  });

  it("pause, scrub and resume is the same listen — counted once, not re-armed", async () => {
    const ep = makeEpisode({ playbackPosition: 0 });
    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      player.api.primeEpisode(ep);
    });
    let p!: Promise<void>;
    act(() => {
      p = player.api.togglePlay(); // first play of the restored show
    });
    plays[0].resolve();
    await act(async () => {
      await p;
    });
    setReadyState(element, 4);
    act(() => {
      element.dispatchEvent(new Event("canplay"));
    });
    expect(reportPlay).toHaveBeenCalledTimes(1);

    // Listen past the retry de-duplication window, so only the counted-listen
    // flag stands between a scrub and a second count.
    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    act(() => {
      player.api.pausePlayback();
    });
    setReadyState(element, 1); // a seek while paused drops readyState
    act(() => {
      player.api.seek(4000);
    });
    act(() => {
      p = player.api.togglePlay();
    });
    plays[1].resolve();
    await act(async () => {
      await p;
    });

    expect(reportPlay).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().loadState).not.toBe("loading");
  });

  it("Next escapes repeat-one", () => {
    const a = makeEpisode();
    const b = makeEpisode();
    const dispatched: Episode[] = [];
    const off = onHdEvent("play-episode", (ep) => dispatched.push(ep));
    act(() => {
      usePlayerStore.setState({ queue: [a, b], queueIndex: 0, currentEpisode: a, repeat: "one" });
    });
    act(() => {
      player.api.playNext();
    });
    off();
    expect(dispatched.map((e) => e.id)).toEqual([b.id]);
  });

  it("the end of a track in repeat-one still repeats", () => {
    const a = makeEpisode();
    const b = makeEpisode();
    act(() => {
      usePlayerStore.setState({ queue: [a, b], queueIndex: 0, repeat: "one" });
    });
    expect(usePlayerStore.getState().next()?.id).toBe(a.id);
  });
});

describe("HD-032: explicit lock-screen handlers, a safe save, immutable updates", () => {
  const handlers = new Map<string, (d?: unknown) => void>();

  beforeEach(() => {
    handlers.clear();
    player.unmount();
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: {
        metadata: null,
        playbackState: "none",
        setActionHandler: (action: string, h: ((d?: unknown) => void) | null) => {
          if (h) handlers.set(action, h);
          else handlers.delete(action);
        },
        setPositionState: () => {},
      },
    });
    (globalThis as Record<string, unknown>).MediaMetadata = class {
      constructor(public init: unknown) {}
    };
    player = mountHook(useAudioPlayer);
  });

  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).mediaSession;
  });

  it("the lock screen's pause pauses, even when the store thinks nothing is playing", async () => {
    const ep = makeEpisode();
    let p!: Promise<void>;
    act(() => {
      p = player.api.playEpisode(ep);
    });
    plays[0].resolve();
    await act(async () => {
      await p;
    });
    expect(element.paused).toBe(false);
    act(() => {
      usePlayerStore.setState({ playing: false }); // out of step
    });
    act(() => {
      handlers.get("pause")!();
    });
    expect(element.paused).toBe(true);
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  it("the lock screen's play plays, even when the store thinks something is", async () => {
    const ep = makeEpisode();
    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      player.api.primeEpisode(ep);
      usePlayerStore.setState({ playing: true }); // out of step
    });
    act(() => {
      handlers.get("play")!();
    });
    expect(element.play).toHaveBeenCalledTimes(1);
  });

  it("a failed position save is caught, not an unhandled rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ep = makeEpisode();
    let p!: Promise<void>;
    act(() => {
      p = player.api.playEpisode(ep);
    });
    plays[0].resolve();
    await act(async () => {
      await p;
    });
    updateEpisode.mockImplementation(() => Promise.reject(new Error("QuotaExceededError")));
    act(() => {
      vi.advanceTimersByTime(POSITION_SAVE_MS);
    });
    await flush();
    expect(warn).toHaveBeenCalledWith("[player] Failed to save position:", expect.any(Error));
    warn.mockRestore();
  });

  it("saves the position the moment the listener pauses", async () => {
    const ep = makeEpisode();
    let p!: Promise<void>;
    act(() => {
      p = player.api.playEpisode(ep);
    });
    plays[0].resolve();
    await act(async () => {
      await p;
    });
    updateEpisode.mockClear();
    act(() => {
      usePlayerStore.getState().setPosition(777);
      player.api.pausePlayback();
    });
    expect(updateEpisode).toHaveBeenCalledWith(ep.id, expect.objectContaining({ playbackPosition: 777 }));
  });

  it("scrubbing a not-yet-loaded show replaces the store's episode instead of writing into it", () => {
    const ep = makeEpisode({ playbackPosition: 10 });
    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
    });
    const before = usePlayerStore.getState().currentEpisode!;
    act(() => {
      player.api.seek(3000);
    });
    const after = usePlayerStore.getState().currentEpisode!;
    expect(after).not.toBe(before);
    expect(after.playbackPosition).toBe(3000);
    expect(before.playbackPosition).toBe(10);
  });
});

describe("HD-033: a local file's retry can work", () => {
  it("does not revoke the object URL the watchdog's retry is about to use", async () => {
    const blobUrl = "blob:https://highdesert.space/0b9c8f1e";
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue(blobUrl);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const ep = makeEpisode({ sourceUrl: undefined });
    const resets = vi.spyOn(element, "removeAttribute");
    let p!: Promise<void>;
    act(() => {
      p = player.api.playEpisode(ep, new File(["x"], "show.mp3"));
    });
    plays[0].reject(new DOMException("refused", "NotSupportedError"));
    await act(async () => {
      await p;
    });
    await flush();

    expect(revoke).not.toHaveBeenCalled();
    // The watchdog's retry ran — the element was reset a second time — and
    // re-assigned the same blob: no cache-buster on a blob: URL, which would
    // name nothing at all.
    expect(resets.mock.calls.filter(([a]) => a === "src")).toHaveLength(2);
    expect(element.getAttribute("src")).toBe(blobUrl);
    create.mockRestore();
    revoke.mockRestore();
  });

  it("a re-picked file for the same show is owned by the store, and the old one freed", async () => {
    let n = 0;
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:https://highdesert.space/file-${++n}`);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const ep = makeEpisode({ sourceUrl: undefined });
    act(() => {
      void player.api.playEpisode(ep, new File(["x"], "show.mp3"));
    });
    expect(usePlayerStore.getState().objectUrl).toBe("blob:https://highdesert.space/file-1");
    // Try Again, same episode, the listener picks the file again.
    act(() => {
      void player.api.playEpisode(ep, new File(["x"], "show.mp3"));
    });
    expect(usePlayerStore.getState().objectUrl).toBe("blob:https://highdesert.space/file-2");
    expect(revoke).toHaveBeenCalledWith("blob:https://highdesert.space/file-1");
    create.mockRestore();
    revoke.mockRestore();
  });
});
