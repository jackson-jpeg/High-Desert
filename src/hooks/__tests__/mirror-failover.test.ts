import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import type { Episode } from "@/db/schema";
import { mountHook, makeMediaElement, setReadyState, type Mounted } from "./support/mount-player";

/**
 * The archive.org outage path, end to end through the real hook, the real
 * watchdog and the real source resolver (src/audio/sources.ts). Only the
 * network edges are stubbed: the stats client, IndexedDB, and the health probe.
 *
 * What must hold, from the mandate:
 *   - an archive error moves the SAME element to /mirror/{fileHash}, at the
 *     listener's position, resumed — and the listen is counted exactly once;
 *   - `play-rejected` never fails over (it is the browser refusing sound);
 *   - a known-down archive.org sends the start straight to the mirror;
 *   - if play() after the swap is refused (iOS, no activation), the error
 *     dialog is raised instead;
 *   - the source is recorded on the play and on the failure.
 */

const reportPlay = vi.fn();
const reportPlaybackFailure = vi.fn();
const seekSpy = vi.fn();
let element: HTMLAudioElement;
let archiveDown = false;
/** play() outcomes, in call order; unlisted calls hang (a load that never answers). */
let plays: Array<"resolve" | "reject-not-allowed" | "hang"> = [];

vi.mock("@/services/stats/client", () => ({
  reportPlay: (...a: unknown[]) => reportPlay(...a),
  reportStop: vi.fn(),
  reportStopBeacon: vi.fn(),
  reportPlaybackFailure: (...a: unknown[]) => reportPlaybackFailure(...a),
}));
vi.mock("@/audio/engine", () => ({
  getMediaElement: () => element,
  initEngine: vi.fn(),
  setEngineVolume: vi.fn(),
  getAnalyserNode: () => null,
  resumeContext: () => Promise.resolve(),
  seekEngine: (t: number) => {
    seekSpy(t);
    return t;
  },
  pauseEngine: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: {
    episodes: { update: () => Promise.resolve(1) },
    history: { where: () => ({ equals: () => ({ sortBy: () => Promise.resolve([]) }) }), add: () => Promise.resolve(1) },
    transaction: (_m: string, _t: unknown, fn: () => Promise<void>) => fn(),
    userPrefs: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
  },
}));
vi.mock("@/services/archive/health", () => ({
  checkArchiveHealth: () => Promise.resolve({ up: !archiveDown }),
  clearHealthCache: vi.fn(),
  archiveKnownDown: () => archiveDown,
}));

const { useAudioPlayer } = await import("@/hooks/useAudioPlayer");
const { usePlayerStore } = await import("@/stores/player-store");
const { disarmWatchdog } = await import("@/audio/playback-watchdog");

type Api = ReturnType<typeof useAudioPlayer>;
let instances: Mounted<Api>[] = [];

// A fresh episode per test: a listen is de-duplicated per episode for two
// minutes (shouldCountPlay), which would otherwise leak between tests.
let seq = 0;
let FILE_HASH = "";
let MIRROR = "";
const ARCHIVE = "https://archive.org/download/ultimate-ultimate-art-bell-collection/1997-09-11.mp3";

function episode(over: Partial<Episode> = {}): Episode {
  seq++;
  const fileName = `1997-09-11 - Coast to Coast AM - Area 51 (${seq}).mp3`;
  FILE_HASH = `archive:ultimate-ultimate-art-bell-collection:${fileName}`;
  MIRROR = `${window.location.origin}/mirror/${encodeURIComponent(FILE_HASH)}`;
  return {
    id: 7 + seq,
    fileHash: FILE_HASH,
    fileName,
    archiveIdentifier: "ultimate-ultimate-art-bell-collection",
    title: "Area 51",
    sourceUrl: ARCHIVE,
    duration: 10_800,
    playbackPosition: 600,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Episode;
}

function mediaError(code: number) {
  Object.defineProperty(element, "error", {
    value: { code, message: code === 4 ? "MEDIA_ELEMENT_ERROR: Format error" : "net::ERR_CONNECTION_RESET" },
    configurable: true,
  });
  element.dispatchEvent(new Event("error"));
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  archiveDown = false;
  plays = [];
  let call = 0;
  element = makeMediaElement(() => {
    const what = plays[call++] ?? "hang";
    if (what === "resolve") return Promise.resolve();
    if (what === "reject-not-allowed") return Promise.reject(new DOMException("denied", "NotAllowedError"));
    return new Promise<void>(() => {});
  });
  usePlayerStore.setState({
    currentEpisode: null, queue: [], queueIndex: -1, playing: false, position: 0,
    duration: 0, loadState: "idle", error: null, failureKind: null, source: null,
  });
  instances = [mountHook(useAudioPlayer), mountHook(useAudioPlayer)];
});

afterEach(() => {
  disarmWatchdog();
  for (const i of instances) i.unmount();
  instances = [];
});

const api = () => instances[0].api;

describe("archive.org fails → the mirror", () => {
  it("an archive error moves the same element to the mirror, keeps the position, and counts one listen", async () => {
    plays = ["hang", "resolve"]; // archive never starts; the mirror does
    const before = element;
    act(() => void api().playEpisode(episode()));
    expect(element.src).toBe(ARCHIVE);

    act(() => mediaError(4)); // what a dead archive.org request looks like
    await settle();

    expect(element).toBe(before);
    expect(element.src).toBe(MIRROR);
    expect(seekSpy).toHaveBeenLastCalledWith(600);
    expect(usePlayerStore.getState().source).toBe("mirror");
    expect(usePlayerStore.getState().playing).toBe(true);
    expect(reportPlay).toHaveBeenCalledTimes(1);
    expect(reportPlay.mock.calls[0][2]).toBe("mirror");

    // The mirror becomes playable: the failover is recorded as the archive's
    // failure, rescued.
    setReadyState(element, 4);
    act(() => element.dispatchEvent(new Event("canplay")));
    expect(reportPlaybackFailure).toHaveBeenCalledTimes(1);
    expect(reportPlaybackFailure.mock.calls[0][0]).toMatchObject({
      kind: "network-error",
      recovered: true,
      source: "archive",
    });
  });

  it("play-rejected does not fail over — the browser refused sound, not the host", async () => {
    plays = ["reject-not-allowed", "hang"];
    act(() => void api().playEpisode(episode()));
    await settle();
    expect(element.src).not.toContain("/mirror/");
    expect(element.src.startsWith(ARCHIVE)).toBe(true); // the ordinary retry, same host
    expect(usePlayerStore.getState().source).toBe("archive");
  });

  it("mid-show, an archive network error resumes on the mirror where the listener was, without a second listen", async () => {
    plays = ["resolve", "resolve"];
    await act(async () => {
      await api().playEpisode(episode());
    });
    setReadyState(element, 4);
    act(() => element.dispatchEvent(new Event("canplay")));
    expect(reportPlay).toHaveBeenCalledTimes(1);
    Object.defineProperty(element, "currentTime", { value: 4321, writable: true, configurable: true });

    // 72 minutes in — where a mid-show failure actually happens, and far past
    // the two-minute play de-duplication (shouldCountPlay), which would
    // otherwise hide a second count made at the failover.
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 4321_000);
    try {
      act(() => mediaError(2));
      await settle();
    } finally {
      clock.mockRestore();
    }

    expect(element.src).toBe(MIRROR);
    expect(seekSpy).toHaveBeenLastCalledWith(4321);
    expect(usePlayerStore.getState().playing).toBe(true);
    expect(reportPlay).toHaveBeenCalledTimes(1);
  });

  it("when the health probe says archive.org is down, the start goes straight to the mirror", async () => {
    archiveDown = true;
    plays = ["resolve"];
    await act(async () => {
      await api().playEpisode(episode());
    });
    expect(element.src).toBe(MIRROR);
    expect(reportPlay.mock.calls[0][2]).toBe("mirror");
  });

  it("if play() is refused after the swap (iOS without activation), the error dialog is raised", async () => {
    plays = ["hang", "reject-not-allowed"];
    act(() => void api().playEpisode(episode()));
    act(() => mediaError(4));
    await settle();
    const s = usePlayerStore.getState();
    expect(s.loadState).toBe("failed");
    expect(s.failureKind).toBe("play-rejected");
    expect(reportPlay).not.toHaveBeenCalled();
  });

  it("archive.org's play() rejecting after the failover moved the element is not charged to the mirror", async () => {
    // The spec's order for a source that fails (media element "dedicated media
    // source failure steps"): pending play() promises are rejected with
    // NotSupportedError, then "error" fires — in the same task. The rejection's
    // handlers run as microtasks afterwards, by which time the error handler
    // has already moved the element to the mirror. The helper's element models
    // load() aborting pending plays, so the first play() is taken over here to
    // reproduce that order exactly.
    plays = ["hang", "hang"];
    const helperPlay = element.play.bind(element);
    let rejectFirst: (err: unknown) => void = () => {};
    let n = 0;
    element.play = vi.fn(() => {
      n++;
      const p = helperPlay();
      if (n > 1) return p;
      p.catch(() => {}); // the helper's own promise: superseded, aborted later
      return new Promise<void>((_, reject) => {
        rejectFirst = reject;
      });
    });
    act(() => void api().playEpisode(episode()));
    await act(async () => {
      rejectFirst(new DOMException("The element has no supported sources.", "NotSupportedError"));
      mediaError(4);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    const s = usePlayerStore.getState();
    expect(element.src).toBe(MIRROR);
    expect(s.loadState).not.toBe("failed");
    expect(s.error).toBeNull();
    expect(reportPlaybackFailure).not.toHaveBeenCalled();
    // Charged as play-rejected, it would either fail the mirror attempt or earn
    // it a retry: a third play() that tears down the stream being waited on.
    expect(n, "archive.org's play(), then the mirror's — nothing else").toBe(2);
  });

  it("the failover spends the retry: the mirror failing too raises the dialog, not a second archive request", async () => {
    plays = ["hang", "hang"];
    act(() => void api().playEpisode(episode()));
    act(() => mediaError(4));
    await settle();
    expect(element.src).toBe(MIRROR);
    act(() => mediaError(4));
    await settle();
    expect(element.src).toBe(MIRROR);
    expect(usePlayerStore.getState().loadState).toBe("failed");
    expect(reportPlaybackFailure.mock.calls.at(-1)![0]).toMatchObject({ recovered: false, source: "mirror" });
  });
});
