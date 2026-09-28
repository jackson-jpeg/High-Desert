import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import type { Episode } from "@/db/schema";
import type { LiveSchedule, ProgramSlot } from "@/lib/live/schedule";
import { mountHook, makeMediaElement, setReadyState, type Mounted } from "@/hooks/__tests__/support/mount-player";

/**
 * Synced playback, through the real player.
 *
 * The real `useAudioPlayer` is mounted (as production mounts it), with its real
 * media-element listeners and the real engine seek; the live station drives it
 * through `playEpisode` — the same call the layout's play-episode handler
 * makes. Only the network, the database and the watchdog's retry policy are
 * replaced. So "one listen per show" is observed at `reportPlay`, the call that
 * writes the leaderboard and the event log, and "resync" at the element's
 * `currentTime`.
 */

const reportPlay = vi.fn<(episodeId: string, sessionId: string) => void>();
let element: HTMLAudioElement;
/** Every write to element.currentTime — a seek — in order. */
let seeks: number[];
/**
 * The element's playhead: where it was put, and — while it is streaming —
 * advancing with the clock, as a real one does. jsdom plays nothing.
 */
let anchor = { pos: 0, at: 0 };
let flowing = false;
function playhead(): number {
  return flowing && !element.paused ? anchor.pos + (Date.now() - anchor.at) / 1000 : anchor.pos;
}
/** Move the playhead as the network would (a stall, a skip) — not a seek. */
function setPlayhead(v: number) {
  anchor = { pos: v, at: Date.now() };
}

const reportPlaybackFailure = vi.hoisted(() => vi.fn());
vi.mock("@/services/stats/client", () => ({
  reportPlay: (episodeId: string, sessionId: string) => reportPlay(episodeId, sessionId),
  reportStop: vi.fn(),
  reportStopBeacon: vi.fn(),
  reportPlaybackFailure,
}));
/** The browser's answer to the next play(): refused, as a backgrounded iPhone refuses it. */
let refusePlay = false;
/** Every pause() of the element, in order: a handover must never make one. */
let pauses = 0;

vi.mock("@/audio/engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/audio/engine")>();
  const bound = () => real.initEngine(element);
  return {
    ...real,
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
    engineState: () => {
      bound();
      return real.engineState();
    },
    onEngineEvent: (type: Parameters<typeof real.onEngineEvent>[0], fn: () => void) => {
      bound();
      return real.onEngineEvent(type, fn);
    },
    playBridge: () => {
      bound();
      return real.playBridge();
    },
    endBridge: () => {
      bound();
      real.endBridge();
    },
    stopBridge: () => {
      bound();
      real.stopBridge();
    },
  };
});

vi.mock("@/db", () => ({
  db: {
    episodes: { update: () => Promise.resolve(1) },
    progress: { upsert: () => Promise.resolve(true) },
    userPrefs: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
  },
}));

vi.mock("@/services/archive/health", () => ({
  checkArchiveHealth: () => Promise.resolve({ up: true }),
  clearHealthCache: vi.fn(),
  archiveKnownDown: () => false,
}));

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
  describeMediaError: () => "",
  setFailureHandler: vi.fn(),
  setFailoverHandler: vi.fn(),
}));

const { useAudioPlayer } = await import("@/hooks/useAudioPlayer");
const { usePlayerStore } = await import("@/stores/player-store");
const { useProgressStore } = await import("@/stores/progress-store");
const { useLiveStore } = await import("@/stores/live-store");
const { createLiveStation, DRIFT_CHECK_MS, TUNED_MARK } = await import("../live-controller");
const liveSession = await import("../live-session");
const { __testing: playSessionTesting } = await import("../play-session");
const engine = await import("@/audio/engine");

const T0 = Date.UTC(2026, 8, 25, 18, 0, 0);
const GAP = 8_000;

let seq = 0;
function slot(name: string, start: number, durationSec: number): ProgramSlot {
  seq += 1;
  return {
    fileHash: `archive:coll:${name}-${seq}.mp3`,
    episodeId: `coll--${name}-${seq}`,
    title: name,
    airDate: "1997-09-25",
    guestName: null,
    showType: "coast",
    duration: durationSec,
    sourceUrl: `https://archive.org/download/coll/${name}-${seq}.mp3`,
    kind: "fan-favorite",
    start,
    end: start + durationSec * 1000,
  };
}

let idSeq = 100;
function episodeFor(s: ProgramSlot): Episode {
  const fileName = s.fileHash.split(":").slice(2).join(":");
  return {
    id: ++idSeq,
    fileHash: s.fileHash,
    fileName,
    filePath: s.sourceUrl!,
    fileSize: 1,
    title: s.title,
    duration: s.duration,
    sourceUrl: s.sourceUrl!,
    archiveIdentifier: "coll",
    createdAt: 0,
    updatedAt: 0,
  } as Episode;
}

let A: ProgramSlot;
let B: ProgramSlot;
let player: Mounted<ReturnType<typeof useAudioPlayer>>;
let station: ReturnType<typeof createLiveStation>;
let uninstall: () => void;
// The real bridge (the ID and the quiet on the player's element), watched.
const stationId = {
  start: vi.fn(() => engine.playBridge()),
  stop: vi.fn(() => engine.endBridge()),
  release: vi.fn(() => engine.stopBridge()),
};
const prefetch = vi.fn<(slot: ProgramSlot) => void>();
const episodes = new Map<string, Episode>();

function makeElement(): HTMLAudioElement {
  const el = makeMediaElement(
    vi.fn(() =>
      refusePlay
        ? Promise.reject(new DOMException("The request is not allowed by the user agent.", "NotAllowedError"))
        : Promise.resolve(),
    ),
  );
  const pause = el.pause.bind(el);
  el.pause = () => {
    pauses += 1;
    pause();
  };
  // What the player last asked for. jsdom's own playbackRate is reset by its
  // load algorithm, which hid whether the player set 1× or the listener's rate.
  let rate = 1;
  Object.defineProperty(el, "playbackRate", {
    get: () => rate,
    set: (v: number) => {
      rate = v;
    },
    configurable: true,
  });
  Object.defineProperty(el, "currentTime", {
    get: playhead,
    set: (v: number) => {
      setPlayhead(v);
      seeks.push(v);
    },
    configurable: true,
  });
  return el;
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Where the station is right now, in seconds into `s`. */
const stationAt = (s: ProgramSlot) => (Date.now() - s.start) / 1000;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
  reportPlay.mockClear();
  seeks = [];
  anchor = { pos: 0, at: T0 };
  flowing = false;
  watching = false;
  refusePlay = false;
  pauses = 0;
  reportPlaybackFailure.mockClear();
  prefetch.mockClear();
  // The lock screen: jsdom has no Media Session.
  Object.defineProperty(navigator, "mediaSession", {
    value: { metadata: null, playbackState: "none", setActionHandler: () => {}, setPositionState: () => {} },
    configurable: true,
  });
  vi.stubGlobal(
    "MediaMetadata",
    class {
      constructor(init: MediaMetadataInit) {
        Object.assign(this, init);
      }
    },
  );
  liveSession.__testing.reset();
  playSessionTesting.reset();
  useProgressStore.getState().reset();
  element = makeElement();
  engine.endBridge();
  usePlayerStore.setState({
    currentEpisode: null,
    queue: [],
    queueIndex: -1,
    playing: false,
    position: 0,
    duration: 0,
    loadState: "idle",
    error: null,
    volume: 0.6,
    playbackRate: 1,
  });
  sessionStorage.clear();
  useLiveStore.setState({
    tuned: false,
    paused: false,
    phase: "off",
    current: null,
    clockOffsetMs: 0,
    clockRttMs: 10,
    schedule: null,
    drift: null,
  });
  // A has been on for ten minutes; B follows after the station ID.
  A = slot("show-a", T0 - 600_000, 1800);
  B = slot("show-b", A.end + GAP, 3600);
  for (const s of [A, B]) episodes.set(s.fileHash, episodeFor(s));
  const schedule: LiveSchedule = {
    day: "2026-09-25",
    tz: "America/Los_Angeles",
    serverNow: T0,
    stationIdSec: 8,
    now: { slot: A, startedAt: A.start, offsetSec: 600, endsAt: A.end },
    upNext: [B],
    rest: [],
    guide: [A, B],
    outage: false,
  };
  useLiveStore.getState().setSchedule(schedule);
  for (const fn of Object.values(stationId)) fn.mockClear();

  player = mountHook(useAudioPlayer);
  station = createLiveStation({
    fetchSchedule: async () => schedule,
    fetchServerNow: async () => Date.now(),
    // What the layout's play-episode handler does with a streamed episode.
    startEpisode: (ep) => void player.api.playEpisode(ep),
    resolveEpisode: (s) => episodes.get(s.fileHash)!,
    stationId,
    prefetch,
  });
  uninstall = station.install();
});

afterEach(() => {
  uninstall();
  player.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The element has data and its playhead moves with the clock. */
function streaming() {
  setReadyState(element, 4);
  setPlayhead(playhead());
  flowing = true;
}
/** The network stops delivering: the playhead freezes where it is. */
function stall() {
  setPlayhead(playhead());
  flowing = false;
}

describe("tuning in", () => {
  it("lands where the station is — mid-show, like real radio — through the ordinary play path", async () => {
    act(() => station.tuneIn());
    await flush();
    expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(A.fileHash);
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(playhead()).toBeCloseTo(600, 3);
    expect(usePlayerStore.getState().playing).toBe(true);
    expect(useLiveStore.getState()).toMatchObject({ tuned: true, phase: "show", current: A });
    expect(reportPlay).toHaveBeenCalledTimes(1);
  });

  it("uses the synced server clock, not the local one", async () => {
    // This browser's clock is 40 s slow.
    useLiveStore.getState().setClock(40_000, 12);
    act(() => station.tuneIn());
    await flush();
    expect(playhead()).toBeCloseTo(640, 3);
  });
});

describe("staying in sync", () => {
  it("corrects drift past 2 s with one quiet seek, and leaves drift within 2 s alone", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    seeks = [];

    // Playing in step: several checks, no seeks.
    await flush(3 * DRIFT_CHECK_MS);
    expect(seeks).toEqual([]);
    expect(useLiveStore.getState().drift).toBeCloseTo(0, 3);

    // The element falls 1.5 s behind the station: left alone.
    setPlayhead(stationAt(A) - 1.5);
    await flush(2 * DRIFT_CHECK_MS);
    expect(seeks).toEqual([]);
    expect(useLiveStore.getState().drift).toBeCloseTo(-1.5, 3);

    // 1.5 s ahead: left alone too.
    setPlayhead(stationAt(A) + 1.5);
    await flush(DRIFT_CHECK_MS);
    expect(seeks).toEqual([]);

    // 6 s behind: one seek, to where the station is, at the next check.
    setPlayhead(stationAt(A) - 6);
    await flush(DRIFT_CHECK_MS);
    expect(seeks).toHaveLength(1);
    expect(seeks[0]).toBeCloseTo(stationAt(A), 3);
    expect(playhead()).toBeCloseTo(stationAt(A), 3);
    // …and it stays put after that.
    await flush(2 * DRIFT_CHECK_MS);
    expect(seeks).toHaveLength(1);
    expect(usePlayerStore.getState().error).toBeNull();
  });

  it("resyncs as soon as a stall ends", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    await flush(1_000);
    // A stall: the element waits, and the station moves on without it.
    stall();
    act(() => {
      element.dispatchEvent(new Event("waiting"));
    });
    await flush(7_000);
    expect(stationAt(A) - playhead()).toBeCloseTo(7, 3);
    seeks = [];
    streaming();
    act(() => {
      element.dispatchEvent(new Event("playing"));
    });
    // Corrected at once, not at the next ten-second check.
    expect(seeks).toHaveLength(1);
    expect(seeks[0]).toBeCloseTo(stationAt(A), 3);
  });

  it("does not resync on a `playing` that follows no stall", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    setPlayhead(stationAt(A) - 5);
    seeks = [];
    act(() => {
      element.dispatchEvent(new Event("playing"));
    });
    expect(seeks).toEqual([]);
  });

  it("resyncs quietly on returning to the tab", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    setPlayhead(stationAt(A) - 9);
    seeks = [];
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(seeks).toHaveLength(1);
    expect(seeks[0]).toBeCloseTo(stationAt(A), 3);
  });
});

describe("one listen per show", () => {
  it("resyncs, stalls and seeks never count again; the next show counts once", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    expect(reportPlay).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 4; i++) {
      setPlayhead(stationAt(A) - 10);
      await flush(DRIFT_CHECK_MS);
      stall();
      act(() => {
        element.dispatchEvent(new Event("waiting"));
      });
      await flush(4_000);
      streaming();
      act(() => {
        element.dispatchEvent(new Event("playing"));
      });
    }
    expect(seeks.length).toBeGreaterThan(3);
    expect(reportPlay).toHaveBeenCalledTimes(1);

    // A ends: the station ID, not the queue — and no play counted in the gap.
    await flush(A.end - Date.now());
    expect(useLiveStore.getState().phase).toBe("station-id");
    expect(stationId.start).toHaveBeenCalledTimes(1);
    expect(element.src).toMatch(/\/audio\/station-id\.mp3$/);
    expect(reportPlay).toHaveBeenCalledTimes(1);

    // B starts on its minute, from its top.
    await flush(GAP);
    expect(useLiveStore.getState()).toMatchObject({ phase: "show", current: B });
    expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(B.fileHash);
    expect(playhead()).toBeCloseTo(0, 3);
    expect(reportPlay).toHaveBeenCalledTimes(2);
    expect(reportPlay.mock.calls[1][0]).toBe(B.episodeId);
  });

  it("tuning out and back in to the same show does not count it again", async () => {
    act(() => station.tuneIn());
    await flush();
    expect(reportPlay).toHaveBeenCalledTimes(1);
    act(() => station.tuneOut());
    // Past the player's own two-minute retry window, so only the live rule
    // stands between this and a second count.
    await flush(5 * 60_000);
    act(() => station.tuneIn());
    await flush();
    expect(element.play).toHaveBeenCalledTimes(2);
    expect(playhead()).toBeCloseTo(stationAt(A), 3);
    expect(reportPlay).toHaveBeenCalledTimes(1);
  });

  it("the file's own `ended` hands over to the station ID and leaves the queue alone", async () => {
    const next = episodeFor(slot("queued", 0, 60));
    act(() => station.tuneIn());
    await flush();
    act(() => usePlayerStore.getState().enqueue(next));
    // The file ran out a little before the slot's end.
    await flush(A.end - Date.now() - 3_000);
    setPlayhead(A.duration - 3);
    act(() => {
      element.dispatchEvent(new Event("ended"));
    });
    expect(useLiveStore.getState().phase).toBe("station-id");
    expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(A.fileHash);
    // B still starts on its minute.
    await flush(3_000 + GAP);
    expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(B.fileHash);
    expect(reportPlay).toHaveBeenCalledTimes(2);
  });
});

describe("with the screen off: one element, never paused, from one show to the next", () => {
  /** Every 250 ms from `from` to `to`: was the element paused at that instant? */
  async function sampleFrom(to: number) {
    const paused: number[] = [];
    while (Date.now() < to) {
      await flush(250);
      if (element.paused) paused.push(Date.now());
    }
    return paused;
  }

  it("the ID, the quiet, and the next show are each played over the last, with no pause between", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    await flush(A.end - Date.now() - 2_000);
    const plays = vi.mocked(element.play).mock.calls.length;
    pauses = 0;

    // Across the boundary and the whole gap, the element is never paused.
    const pausedDuringID = await sampleFrom(A.end + 8_000 - 500);
    expect(pausedDuringID).toEqual([]);
    expect(element.src).toMatch(/\/audio\/station-id\.mp3$/);
    expect(vi.mocked(element.play).mock.calls.length).toBe(plays + 1);

    // The ID's file ends: quiet on a loop, on the same element. As a real
    // element reports it: eight seconds long, at its end, which for the show
    // it follows would read as an empty file or a dropped connection.
    Object.defineProperty(element, "duration", { value: 8, configurable: true });
    setPlayhead(8);
    act(() => {
      element.dispatchEvent(new Event("ended"));
    });
    expect(reportPlaybackFailure).not.toHaveBeenCalled();
    expect(element.src).toMatch(/\/audio\/station-quiet\.mp3$/);
    expect(element.loop).toBe(true);
    // The ID's `ended` was not the show's: no failure, nothing from the queue.
    expect(usePlayerStore.getState().loadState).not.toBe("failed");
    expect(usePlayerStore.getState().error).toBeNull();
    expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(A.fileHash);

    const pausedToB = await sampleFrom(B.start + 2_000);
    expect(pausedToB).toEqual([]);
    expect(pauses).toBe(0);
    // B took the element over: its own source, not looping, counted once.
    expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(B.fileHash);
    expect(element.src).toBe(B.sourceUrl);
    expect(element.loop).toBe(false);
    expect(engine.isBridging()).toBe(false);
    expect(reportPlay).toHaveBeenCalledTimes(2);
  });

  it("the bridge's seconds are nobody's: no duration, no position", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    await flush(A.end - Date.now());
    const { position, duration } = usePlayerStore.getState();
    setPlayhead(3);
    Object.defineProperty(element, "duration", { value: 8, configurable: true });
    act(() => {
      element.dispatchEvent(new Event("loadedmetadata"));
    });
    await flush(2_000);
    expect(usePlayerStore.getState().duration).toBe(duration);
    expect(usePlayerStore.getState().position).toBe(position);
  });

  it("the lock screen follows the station: the ID between shows, then the next show by name", async () => {
    act(() => station.tuneIn());
    await flush();
    const meta = () => navigator.mediaSession.metadata as unknown as MediaMetadataInit;
    expect(meta()).toMatchObject({ title: "show-a", album: "High Desert Live" });
    await flush(A.end - Date.now() + 1_000);
    expect(meta()).toMatchObject({ title: "Station identification", album: "High Desert Live" });
    await flush(B.start - Date.now() + 1_000);
    expect(meta()).toMatchObject({ title: "show-b", album: "High Desert Live" });
  });

  it("a minute before a show ends, the next show's first bytes are fetched", async () => {
    act(() => station.tuneIn());
    await flush();
    await flush(A.end - Date.now() - 61_000);
    expect(prefetch).not.toHaveBeenCalled();
    await flush(2_000);
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(prefetch.mock.calls[0][0]).toBe(B);
  });

  it("a change of show the browser refuses is recorded as its own kind, and held for a tap to rejoin", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    await flush(B.start - Date.now() - 1_000);
    refusePlay = true;
    await flush(2_000);

    expect(reportPlaybackFailure).toHaveBeenCalledTimes(1);
    expect(reportPlaybackFailure.mock.calls[0][0]).toMatchObject({
      episodeId: B.episodeId,
      kind: "handover-rejected",
      recovered: false,
    });
    expect(reportPlaybackFailure.mock.calls[0][0].detail).toMatch(/^handover to=show /);
    expect(useLiveStore.getState()).toMatchObject({ tuned: true, paused: true, rejoin: true, current: B });
    // Not the error dialog: nobody is looking at the screen.
    expect(usePlayerStore.getState().loadState).not.toBe("failed");
    expect(usePlayerStore.getState().error).toBeNull();

    // Back at the phone: ▶ (the lock screen's, the player's) is a gesture,
    // and lands on the live second of B.
    refusePlay = false;
    await flush(30_000);
    await act(async () => {
      await player.api.resumePlayback();
    });
    await flush();
    expect(useLiveStore.getState()).toMatchObject({ tuned: true, paused: false, rejoin: false, phase: "show", current: B });
    expect(usePlayerStore.getState().playing).toBe(true);
    expect(playhead()).toBeCloseTo(stationAt(B), 3);
    expect(reportPlay).toHaveBeenCalledTimes(2);
  });

  it("the station ID refused counts the same way, charged to the show that follows", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    await flush(A.end - Date.now() - 1_000);
    refusePlay = true;
    await flush(2_000);
    expect(reportPlaybackFailure).toHaveBeenCalledTimes(1);
    expect(reportPlaybackFailure.mock.calls[0][0]).toMatchObject({ episodeId: B.episodeId, kind: "handover-rejected" });
    expect(reportPlaybackFailure.mock.calls[0][0].detail).toMatch(/^handover to=station-id /);
    expect(useLiveStore.getState()).toMatchObject({ paused: true, rejoin: true });
    // Held: B does not start behind the refusal.
    await flush(B.start - Date.now() + 5_000);
    expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(A.fileHash);
  });

  it("a refusal of a tap's own play is not a handover: the ordinary path, not a rejoin", async () => {
    refusePlay = true;
    act(() => station.tuneIn());
    await flush();
    const handovers = reportPlaybackFailure.mock.calls.filter((c) => c[0].kind === "handover-rejected");
    expect(handovers).toEqual([]);
    expect(useLiveStore.getState().rejoin).toBe(false);
    const { noteError } = await import("@/audio/playback-watchdog");
    expect(noteError).toHaveBeenCalledWith("play-rejected");
  });
});

describe("leaving the station", () => {
  it("picking another show tunes out", async () => {
    act(() => station.tuneIn());
    await flush();
    const other = episodeFor(slot("other", 0, 3600));
    await act(async () => {
      await player.api.playEpisode(other);
    });
    expect(useLiveStore.getState().tuned).toBe(false);
    // …and plays from the listener's own position, not the station's.
    expect(playhead()).toBe(0);
  });

  it("Leave the station stops the audio, clears the player, and forgets the tab was tuned", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    expect(sessionStorage.getItem(TUNED_MARK)).toBe("1");
    act(() => station.leave());
    expect(useLiveStore.getState().tuned).toBe(false);
    expect(element.paused).toBe(true);
    expect(element.getAttribute("src")).toBeNull();
    expect(usePlayerStore.getState()).toMatchObject({ currentEpisode: null, playing: false });
    expect(sessionStorage.getItem(TUNED_MARK)).toBeNull();
    // Nothing the station does afterwards reaches the player.
    await flush(A.end - Date.now() + GAP);
    expect(usePlayerStore.getState().currentEpisode).toBeNull();
    expect(stationId.start).not.toHaveBeenCalled();
  });

  it("■ Stop in the player leaves the station rather than holding it", async () => {
    act(() => station.tuneIn());
    await flush();
    act(() => player.api.stopPlayback());
    await flush();
    expect(useLiveStore.getState()).toMatchObject({ tuned: false, paused: false });
    expect(sessionStorage.getItem(TUNED_MARK)).toBeNull();
  });

  it("while live, a seek is refused with a reason instead of being undone ten seconds later", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    const before = seeks.length;
    act(() => player.api.seek(playhead() + 30));
    expect(seeks.length).toBe(before);
    const { useToastStore } = await import("@/stores/toast-store");
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/listening live/);
    // Held, the listener's own seek is theirs again.
    act(() => player.api.pausePlayback());
    await flush();
    act(() => player.api.seek(5));
    expect(seeks.at(-1)).toBe(5);
  });

  it("the station plays at 1× whatever speed the listener had set", async () => {
    // Set, and applied, well before tuning in — as a listener's saved speed is.
    act(() => usePlayerStore.setState({ playbackRate: 1.5 }));
    await flush();
    expect(element.playbackRate).toBe(1.5);
    act(() => station.tuneIn());
    await flush();
    expect(element.playbackRate).toBe(1);
    // And an ordinary show afterwards gets the listener's speed back.
    const other = episodeFor(slot("other", 0, 3600));
    await act(async () => {
      await player.api.playEpisode(other);
    });
    expect(element.playbackRate).toBe(1.5);
  });

  it("a library show picked while held paused leaves the station, and plays", async () => {
    act(() => station.tuneIn());
    await flush();
    act(() => player.api.pausePlayback());
    await flush();
    expect(useLiveStore.getState().paused).toBe(true);
    const other = episodeFor(slot("other", 0, 3600));
    await act(async () => {
      await player.api.playEpisode(other);
    });
    expect(useLiveStore.getState().tuned).toBe(false);
    expect(usePlayerStore.getState()).toMatchObject({ playing: true });
    expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(other.fileHash);
  });
});

describe("pausing holds the station", () => {
  it("stays tuned, paused; ▶ goes back to where the station is now, and counts nothing again", async () => {
    act(() => station.tuneIn());
    await flush();
    streaming();
    act(() => player.api.pausePlayback());
    await flush();
    expect(useLiveStore.getState()).toMatchObject({ tuned: true, paused: true, phase: "show" });
    const pausedAt = playhead();

    await flush(45_000);
    // A paused element sits where it stopped; the fake playhead has to be
    // told, or it "advances" through the pause and a resume looks like a jump.
    setPlayhead(pausedAt);
    await act(async () => {
      await player.api.resumePlayback();
    });
    expect(useLiveStore.getState()).toMatchObject({ tuned: true, paused: false });
    expect(usePlayerStore.getState().playing).toBe(true);
    expect(playhead()).toBeCloseTo(stationAt(A), 3);
    expect(playhead() - pausedAt).toBeGreaterThan(44);
    expect(reportPlay).toHaveBeenCalledTimes(1);
  });

  it("nothing starts behind a paused player; ▶ after the show ended starts the one on now", async () => {
    act(() => station.tuneIn());
    await flush();
    act(() => player.api.pausePlayback());
    await flush();
    // Past A's end and the station ID: held, so no ID and no B.
    await flush(A.end - Date.now() + GAP + 60_000);
    expect(stationId.start).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(A.fileHash);
    expect(useLiveStore.getState().paused).toBe(true);

    await act(async () => {
      await player.api.togglePlay();
    });
    await flush();
    expect(useLiveStore.getState()).toMatchObject({ tuned: true, paused: false, phase: "show", current: B });
    expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(B.fileHash);
    expect(playhead()).toBeCloseTo(stationAt(B), 3);
  });

  it("a reload of a tuned tab comes back held, and ▶ lands on the live second", async () => {
    act(() => station.tuneIn());
    await flush();
    expect(reportPlay).toHaveBeenCalledTimes(1);
    // The page goes away (no teardown runs on unload) and comes back: a fresh
    // store and a fresh station, the same tab's sessionStorage.
    useLiveStore.setState({ tuned: false, paused: false, phase: "off", current: null });
    uninstall();
    usePlayerStore.setState({ playing: false });
    station = createLiveStation({
      fetchSchedule: async () => useLiveStore.getState().schedule,
      fetchServerNow: async () => Date.now(),
      startEpisode: (ep) => void player.api.playEpisode(ep),
      resolveEpisode: (s) => episodes.get(s.fileHash)!,
      stationId,
    });
    uninstall = station.install();
    expect(useLiveStore.getState()).toMatchObject({ tuned: true, paused: true });

    await flush(30_000);
    await act(async () => {
      await player.api.resumePlayback();
    });
    await flush();
    expect(useLiveStore.getState()).toMatchObject({ tuned: true, paused: false, phase: "show", current: A });
    expect(playhead()).toBeCloseTo(stationAt(A), 3);
  });

  it("a held station is not live for the heartbeat; resumed, it is", async () => {
    const { tunedInLive } = await import("@/hooks/usePresence");
    act(() => station.tuneIn());
    await flush();
    expect(tunedInLive()).toBe(true);
    act(() => player.api.pausePlayback());
    await flush();
    expect(tunedInLive()).toBe(false);
    await act(async () => {
      await player.api.resumePlayback();
    });
    expect(tunedInLive()).toBe(true);
  });
});
