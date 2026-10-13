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
let plays: Array<"resolve" | "reject-not-allowed" | "reject-not-supported" | "hang" | (() => Promise<void>)> = [];

vi.mock("@/services/stats/client", () => ({
  reportPlay: (...a: unknown[]) => reportPlay(...a),
  reportStop: vi.fn(),
  reportStopBeacon: vi.fn(),
  reportPlaybackFailure: (...a: unknown[]) => reportPlaybackFailure(...a),
}));
vi.mock("@/audio/engine", () => ({
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
    seekSpy(t);
    return t;
  },
  pauseEngine: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: {
    episodes: { update: () => Promise.resolve(1) },
    progress: { upsert: () => Promise.resolve(true) },
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
const { useProgressStore, positionOf } = await import("@/stores/progress-store");
const { disarmWatchdog } = await import("@/audio/playback-watchdog");
const { useOutageStore, selectSlowCover } = await import("@/stores/outage-store");

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
  // Saved 600 s in — in the progress mirror (HD-016), by fileHash.
  useProgressStore.getState().patch(FILE_HASH, { playbackPosition: 600 });
  return {
    id: 7 + seq,
    fileHash: FILE_HASH,
    fileName,
    archiveIdentifier: "ultimate-ultimate-art-bell-collection",
    title: "Area 51",
    sourceUrl: ARCHIVE,
    duration: 10_800,
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
  useOutageStore.setState({ failedOver: null });
  plays = [];
  let call = 0;
  element = makeMediaElement(() => {
    const what = plays[call++] ?? "hang";
    if (typeof what === "function") return what();
    if (what === "resolve") return Promise.resolve();
    if (what === "reject-not-supported") return Promise.reject(new DOMException("no supported sources", "NotSupportedError"));
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
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
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

  it("a failover with no outage verdict raises the quiet notice for that show, and only that show", async () => {
    useOutageStore.setState({ archiveUp: true, failedOver: null });
    plays = ["hang", "resolve"];
    act(() => void api().playEpisode(episode()));
    expect(useOutageStore.getState().failedOver).toBeNull();
    act(() => mediaError(4));
    await settle();
    const hash = usePlayerStore.getState().currentEpisode!.fileHash;
    expect(useOutageStore.getState().failedOver).toBe(hash);
    const player = () => ({
      source: usePlayerStore.getState().source,
      fileHash: usePlayerStore.getState().currentEpisode?.fileHash,
    });
    expect(selectSlowCover(useOutageStore.getState(), player())).toBe(true);
    // Control: the same state with an outage verdict is the outage banner's, not this.
    expect(selectSlowCover({ archiveUp: false, failedOver: hash }, player())).toBe(false);
    // Control: back on archive.org, the notice is gone without anyone clearing it.
    expect(selectSlowCover(useOutageStore.getState(), { ...player(), source: "archive" })).toBe(false);
  });

  it("play-rejected does not fail over — the browser refused sound, not the host", async () => {
    plays = ["reject-not-allowed", "hang"];
    act(() => void api().playEpisode(episode()));
    await settle();
    expect(element.src).not.toContain("/mirror/");
    expect(element.src.startsWith(ARCHIVE)).toBe(true); // the ordinary retry, same host
    expect(usePlayerStore.getState().source).toBe("archive");
    expect(useOutageStore.getState().failedOver).toBeNull();
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

  describe("an `ended` far short of the catalogued end (iOS Safari's dropped connection)", () => {
    /** Playing from archive.org, 72 minutes into a three-hour show. */
    async function playingAt(t: number, elementDuration: number) {
      plays = ["resolve", "resolve"];
      // `next` first: episode() points MIRROR/FILE_HASH at the last one made.
      const next = episode();
      const ep = episode();
      await act(async () => {
        await api().playEpisode(ep);
      });
      usePlayerStore.setState({ queue: [ep, next], queueIndex: 0 });
      setReadyState(element, 4);
      act(() => element.dispatchEvent(new Event("canplay")));
      Object.defineProperty(element, "currentTime", { value: t, writable: true, configurable: true });
      Object.defineProperty(element, "duration", { value: elementDuration, configurable: true });
      Object.defineProperty(element, "error", { value: null, configurable: true });
      return { ep, next };
    }

    it("resumes on the mirror at the same position, keeps the show, and does not advance the queue", async () => {
      // What the simulator recorded: stalled, pause, ended — no error — at
      // 10,000 s of a 10,800 s broadcast whose element knows it is longer.
      const { ep } = await playingAt(10_000, 10_800);
      const now = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now + 600_000);
      try {
        act(() => element.dispatchEvent(new Event("ended")));
        await settle();
      } finally {
        clock.mockRestore();
      }
      expect(element.src).toBe(MIRROR);
      expect(seekSpy).toHaveBeenLastCalledWith(10_000);
      expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(ep.fileHash);
      expect(usePlayerStore.getState().queueIndex).toBe(0);
      expect(usePlayerStore.getState().playing).toBe(true);
      // Not "finished": the saved position was not reset to the top.
      expect(positionOf(ep.fileHash)).not.toBe(0);
      expect(reportPlay).toHaveBeenCalledTimes(1);
    });

    it("control: an `ended` at the real end advances the queue as always", async () => {
      const { ep } = await playingAt(10_795, 10_800);
      act(() => element.dispatchEvent(new Event("ended")));
      await settle();
      expect(element.src).not.toBe(MIRROR);
      // The queue moved on (playTrack hands the next show to the layout's
      // play-episode handler, not mounted here) and the finished show starts
      // from the top next time.
      expect(usePlayerStore.getState().queueIndex).toBe(1);
      expect(positionOf(ep.fileHash)).toBe(0);
    });

    it("control: a file the element itself says has ended is not sent to the mirror", async () => {
      // The element's own duration agrees it is at its end: a short file, which
      // duration-sanity owns — not a dropped connection.
      await playingAt(9_000, 9_010);
      act(() => element.dispatchEvent(new Event("ended")));
      await settle();
      expect(element.src).not.toBe(MIRROR);
    });
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

describe("why two iOS failovers to the mirror did not recover (2026-09-27)", () => {
  /** Playing from archive.org, 72 minutes in, then archive.org errors. */
  async function playingThenArchiveErrors(opts: { paused?: boolean; hidden?: boolean }) {
    plays = ["resolve", ...plays];
    await act(async () => {
      await api().playEpisode(episode());
    });
    setReadyState(element, 4);
    act(() => element.dispatchEvent(new Event("canplay")));
    reportPlaybackFailure.mockClear();
    Object.defineProperty(element, "currentTime", { value: 4321, writable: true, configurable: true });
    if (opts.paused) act(() => void api().pausePlayback());
    if (opts.hidden) Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => mediaError(4));
    await settle();
    setReadyState(element, 1);
  }

  it("04:34:38: nobody was playing, so the mirror is loaded for the next play, not supervised into a false stall", async () => {
    await playingThenArchiveErrors({ paused: true });
    expect(element.src).toBe(MIRROR);
    const calls = vi.mocked(element.play).mock.calls.length;
    // iOS loads the metadata of an element nobody plays, then suspends.
    act(() => element.dispatchEvent(new Event("suspend")));
    act(() => void vi.advanceTimersByTime(30_000));
    expect(reportPlaybackFailure).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().loadState).not.toBe("failed");
    expect(vi.mocked(element.play).mock.calls.length, "no sound nobody asked for").toBe(calls);
  });

  it("05:02:09: with the screen off the mirror's play() waits for the page; the clock waits with it", async () => {
    let start: () => void = () => {};
    plays = [() => new Promise<void>((r) => (start = r))];
    await playingThenArchiveErrors({ hidden: true });
    expect(element.src).toBe(MIRROR);
    // Five minutes behind the lock screen, with the element saying nothing
    // useful: nothing is judged while play() is still being held.
    act(() => element.dispatchEvent(new Event("waiting")));
    for (let i = 0; i < 30; i++) act(() => void vi.advanceTimersByTime(10_000));
    expect(reportPlaybackFailure).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().loadState).not.toBe("failed");
    // The phone wakes: iOS starts the held play(), and the failover is what
    // it was, archive.org's failure rescued by the mirror.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      start();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    setReadyState(element, 4);
    act(() => element.dispatchEvent(new Event("playing")));
    expect(reportPlaybackFailure).toHaveBeenCalledTimes(1);
    expect(reportPlaybackFailure.mock.calls[0][0]).toMatchObject({ kind: "network-error", recovered: true, source: "archive" });
  });

  it("control: on screen, a mirror that never starts is still given up on", async () => {
    await playingThenArchiveErrors({});
    act(() => element.dispatchEvent(new Event("waiting")));
    act(() => void vi.advanceTimersByTime(30_000));
    expect(usePlayerStore.getState().loadState).toBe("failed");
    expect(reportPlaybackFailure.mock.calls.at(-1)![0]).toMatchObject({ recovered: false, source: "mirror" });
  });

  it("iOS rejecting play() with NotSupportedError is the source failing: straight to the mirror", async () => {
    plays = ["reject-not-supported", "resolve"];
    act(() => void api().playEpisode(episode()));
    await settle();
    await settle();
    expect(element.src).toBe(MIRROR);
    expect(usePlayerStore.getState().playing).toBe(true);
  });

  it("a NotSupportedError row carries the element's own MediaError, which says why (2026-10-11, Firefox)", async () => {
    // archive.org's storage node answered 500 with no CORS header: the element
    // sets code=4 and only then rejects play(). The row used to say only
    // "play NotSupportedError"; the failover's row now names the cause first.
    Object.defineProperty(element, "error", { value: { code: 4, message: "R1: Received 500 HTTP error code" }, configurable: true });
    plays = ["reject-not-supported", "resolve"];
    act(() => void api().playEpisode(episode()));
    await settle();
    await settle();
    expect(element.src).toBe(MIRROR);
    // The mirror plays: the archive's failure is recorded, rescued.
    Object.defineProperty(element, "error", { value: null, configurable: true });
    setReadyState(element, 4);
    act(() => element.dispatchEvent(new Event("canplay")));
    const row = reportPlaybackFailure.mock.calls.at(-1)![0];
    expect(row.detail).toContain("code=4 R1: Received 500 HTTP error code (play NotSupportedError)");
    expect(row).toMatchObject({ kind: "network-error", recovered: true });
  });

  it("a refusal's row says it was a refusal, by the rejection's own name", async () => {
    plays = ["reject-not-allowed", "reject-not-allowed"];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => void api().playEpisode(episode()));
    await settle();
    // Long enough for the retry, the failover and the mirror's first-byte budget.
    act(() => void vi.advanceTimersByTime(60_000));
    await settle();
    // However the attempt ends, its row carries what play() was told.
    expect(usePlayerStore.getState().loadState).toBe("failed");
    expect(reportPlaybackFailure.mock.calls.at(-1)![0].detail).toContain("play NotAllowedError");
  });
});

describe("why 62 failovers to the mirror did not recover (2026-10-12)", () => {
  it("a restored show's ▶: archive.org's play() rejecting after the failover is not charged to the mirror", async () => {
    // The same order as the playEpisode case above, on the other start path:
    // resumePlayback's catch had no "has the element moved on?" check, so the
    // stale rejection failed the mirror attempt it had just been moved to.
    plays = ["hang", "hang"];
    const helperPlay = element.play.bind(element);
    let rejectFirst: (err: unknown) => void = () => {};
    let n = 0;
    element.play = vi.fn(() => {
      n++;
      const p = helperPlay();
      if (n > 1) return p;
      p.catch(() => {});
      return new Promise<void>((_, reject) => {
        rejectFirst = reject;
      });
    });
    const ep = episode();
    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      api().primeEpisode(ep);
    });
    act(() => void api().togglePlay());
    await settle();
    await act(async () => {
      rejectFirst(new DOMException("The element has no supported sources.", "NotSupportedError"));
      mediaError(4);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    const s = usePlayerStore.getState();
    expect(element.src).toBe(MIRROR);
    expect(s.loadState).not.toBe("failed");
    expect(reportPlaybackFailure).not.toHaveBeenCalled();
    expect(n, "archive.org's play(), then the mirror's — nothing else").toBe(2);
  });

  it("the mirror's own play() failing for want of a source is recorded as the mirror failing, not as a refusal", async () => {
    plays = ["hang", "reject-not-supported"];
    act(() => void api().playEpisode(episode()));
    act(() => mediaError(4));
    await settle();
    await settle();
    const s = usePlayerStore.getState();
    expect(s.loadState).toBe("failed");
    expect(s.failureKind).toBe("network-error");
    const row = reportPlaybackFailure.mock.calls.at(-1)![0];
    expect(row).toMatchObject({ kind: "network-error", recovered: false, source: "mirror" });
    expect(row.detail).toContain("play NotSupportedError");
  });

  it("Try Again after archive.org failed this show starts on the mirror, not on archive.org again", async () => {
    useOutageStore.setState({ archiveUp: true, failedOver: null });
    plays = ["hang", "hang", "resolve"];
    const ep = episode();
    act(() => void api().playEpisode(ep));
    act(() => mediaError(4));
    await settle();
    act(() => mediaError(4)); // the mirror fails too: the dialog
    await settle();
    expect(usePlayerStore.getState().loadState).toBe("failed");
    // Try Again replays the same show.
    await act(async () => {
      await api().playEpisode(ep);
    });
    expect(element.src).toBe(MIRROR);
    expect(usePlayerStore.getState().source).toBe("mirror");
  });

  it("control: another show still starts on archive.org", async () => {
    useOutageStore.setState({ archiveUp: true, failedOver: "archive:some-other-show" });
    plays = ["resolve"];
    await act(async () => {
      await api().playEpisode(episode());
    });
    expect(element.src).toBe(ARCHIVE);
  });
});
