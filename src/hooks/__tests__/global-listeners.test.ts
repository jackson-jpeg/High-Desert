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
 * The side effects this hook installs outside React must be installed exactly
 * once — and, the part that went wrong, *at all*.
 *
 * `withGlobals()` exists because the hook is mounted twice (by the desktop
 * layout and by <AudioPlayer/>, whose `return null` sits after the hooks), so
 * every listener, timer and interval would otherwise be installed twice. It
 * ref-counted with a single module-level counter shared across all five of its
 * call sites, which meant `count === 1` was true for exactly one call in the
 * whole hook — whichever ran first, the position timer — and the other four
 * installs never ran. Not once, in any browser, for the life of the code.
 *
 * What that cost, in order of how much it hurt:
 *
 *  - The media element listeners were never attached, so the playback watchdog
 *    could see neither `progress` nor `canplay`. Every load ran its twelve
 *    second deadline out and was reported as a timeout — over audio that was
 *    streaming perfectly — and then the retry tore the element down and
 *    restarted the show. On iOS the retry's `play()` had no user gesture and
 *    was refused, so the broadcast simply stopped twelve seconds in. All 32
 *    rows in `playback_failures` were written that way, and `recovered` was
 *    false on every one of them because the only thing that can set it is
 *    `noteReady()`, reached from a listener that did not exist.
 *  - `setFailureHandler` was never installed, so `PlaybackErrorDialog` could
 *    not open. The failure above was therefore also completely silent.
 *  - Playback position was never persisted, and the unload beacon never fired.
 *
 * Every existing suite passed throughout, because each one mocks the watchdog
 * or asserts on `playEpisode`/`togglePlay` directly. Nothing asserted that the
 * wiring between them existed. That is what this file is for.
 */

const reportPlay = vi.fn();
const reportStop = vi.fn();
const reportStopBeacon = vi.fn();
const updateEpisode = vi.fn(() => Promise.resolve(1));
const setFailureHandler = vi.fn();
const noteReady = vi.fn();
const noteProgress = vi.fn();
const noteListenersAttached = vi.fn();
const noteListenersDetached = vi.fn();
const noteError = vi.fn();
const armWatchdog = vi.fn();

let element: HTMLAudioElement;
/** Whether a load attempt is outstanding — decides who owns an `error`. */
let watching = false;

vi.mock("@/services/stats/client", () => ({
  reportPlay: (...a: unknown[]) => reportPlay(...a),
  reportStop: (...a: unknown[]) => reportStop(...a),
  reportStopBeacon: (...a: unknown[]) => reportStopBeacon(...a),
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
      update: (...a: unknown[]) => updateEpisode(...(a as [])),
    },
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

vi.mock("@/audio/playback-watchdog", () => ({
  armWatchdog: (...a: unknown[]) => armWatchdog(...a),
  // The real one — the point of the detail test below is that production calls it.
  describeMediaError: (e: MediaError | null) =>
    e ? `code=${e.code}${e.message ? ` ${e.message}` : ""}` : null,
  disarmWatchdog: vi.fn(),
  isWatching: () => watching,
  noteError: (...a: unknown[]) => noteError(...a),
  noteListenersAttached: () => noteListenersAttached(),
  noteListenersDetached: () => noteListenersDetached(),
  noteProgress: () => noteProgress(),
  noteReady: () => noteReady(),
  noteSuspectDuration: vi.fn(),
  noteUnplayable: vi.fn(),
  noteWaiting: vi.fn(),
  setFailureHandler: (...a: unknown[]) => setFailureHandler(...a),
}));

const { communityKey } = await import("@/lib/utils/community-key");
const { useAudioPlayer } = await import("@/hooks/useAudioPlayer");
const { usePlayerStore } = await import("@/stores/player-store");

type Api = ReturnType<typeof useAudioPlayer>;

let episodeSeq = 0;
function makeEpisode(over: Partial<Episode> = {}): Episode {
  episodeSeq += 1;
  return {
    id: 100 + episodeSeq,
    fileHash: `archive:coll:show-${episodeSeq}.mp3`,
    fileName: `1997-07-2${episodeSeq} - Coast to Coast AM.mp3`,
    archiveIdentifier: "ultimate-art-bell-collection",
    title: "Coast to Coast AM",
    // Distinct per episode: "armed against the new source" is not decidable if
    // every fixture shares one URL.
    sourceUrl: `https://archive.org/download/coll/show-${episodeSeq}.mp3`,
    duration: 10_800,
    showType: "coast",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Episode;
}

/** Both instances React really mounts: the desktop layout and <AudioPlayer/>. */
let instances: Mounted<Api>[] = [];

function mountBoth(): void {
  instances = [mountHook(useAudioPlayer), mountHook(useAudioPlayer)];
}

describe("globals installed by useAudioPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    watching = false;
    element = makeMediaElement(vi.fn(() => Promise.resolve()));
    usePlayerStore.setState({
      currentEpisode: null,
      queue: [],
      queueIndex: -1,
      playing: false,
      position: 0,
      duration: 0,
      repeat: "off",
      shuffle: false,
      loadState: "idle",
      error: null,
    });
  });

  afterEach(() => {
    for (const i of instances) i.unmount();
    instances = [];
    vi.useRealTimers();
  });

  it("attaches the media element listeners — the bug was that it never did", () => {
    mountBoth();
    // Not "was called twice, deduplicated to once" — the install block itself
    // ran zero times, so the watchdog was supervising with no inputs at all.
    expect(noteListenersAttached).toHaveBeenCalledTimes(1);
  });

  it("routes canplay to the watchdog exactly once, so a retry can be recovered", () => {
    mountBoth();

    act(() => {
      element.dispatchEvent(new Event("canplay"));
    });

    // Once, not twice (two instances) and — the regression — not zero.
    // `noteReady()` is the *only* thing that can mark an attempt recovered,
    // which is why `recovered` was false on all 32 recorded failures.
    expect(noteReady).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().loadState).toBe("playing");
  });

  it("routes progress to the watchdog, so a slow load is not called a dead one", () => {
    mountBoth();

    act(() => {
      element.dispatchEvent(new Event("progress"));
    });

    expect(noteProgress).toHaveBeenCalledTimes(1);
  });

  it("installs the failure handler, without which nothing can raise the dialog", () => {
    mountBoth();

    expect(setFailureHandler).toHaveBeenCalledTimes(1);
    const handler = setFailureHandler.mock.calls[0][0] as (k: string) => void;

    act(() => {
      handler("timeout");
    });

    const s = usePlayerStore.getState();
    expect(s.loadState).toBe("failed");
    expect(s.error).toBe("This broadcast isn't coming through.");
  });

  it("advances the queue by exactly one at the end of a show", () => {
    // Two `ended` handlers would skip a track; zero would strand the listener at
    // the end of the episode with a dead player. It was zero.
    mountBoth();
    const [a, b] = [makeEpisode(), makeEpisode()];

    act(() => {
      usePlayerStore.setState({ queue: [a, b], queueIndex: 0, currentEpisode: a });
      Object.defineProperty(element, "duration", {
        value: 10_800,
        configurable: true,
      });
      usePlayerStore.getState().setDuration(10_800);
      element.dispatchEvent(new Event("ended"));
    });

    expect(usePlayerStore.getState().queueIndex).toBe(1);
  });

  it("reports the stop once per unload, not once per mounted instance", () => {
    mountBoth();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(reportStopBeacon).toHaveBeenCalledTimes(1);
  });

  it("persists the position on a single interval while playing", () => {
    vi.useFakeTimers();
    mountBoth();
    const ep = makeEpisode();

    act(() => {
      usePlayerStore.setState({
        currentEpisode: ep,
        queue: [ep],
        queueIndex: 0,
        playing: true,
        position: 1234,
      });
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const positionWrites = updateEpisode.mock.calls.filter(
      (c) => (c as unknown as [number, Record<string, unknown>])[1]
        ?.playbackPosition !== undefined,
    );
    expect(positionWrites).toHaveLength(1);
  });

  it("tears every global down when the last instance unmounts, and rebuilds them", () => {
    // The release path was the same bug twice: one variable held one cleanup for
    // five installs. A hook that cannot be remounted cleanly is a hook that
    // breaks on the first client-side navigation that unmounts the layout.
    mountBoth();
    for (const i of instances) i.unmount();
    instances = [];

    expect(noteListenersDetached).toHaveBeenCalledTimes(1);

    noteReady.mockClear();
    mountBoth();

    act(() => {
      element.dispatchEvent(new Event("canplay"));
    });

    expect(noteReady).toHaveBeenCalledTimes(1);
  });

  it("hands the next show to the watchdog, not the one that just ended", async () => {
    // The other half of an episode boundary. `ended` advances the queue and
    // dispatches `hd:play-episode`; the desktop layout answers it by calling
    // `playEpisode`, which assigns the new source and only then arms. If the
    // watchdog kept the finished episode's url, its retry would re-request the
    // show the listener has already heard — and report the failure against the
    // wrong one. This whole path had never executed in production: `ended` came
    // from a listener that was never attached.
    mountBoth();
    const [a, b] = [makeEpisode(), makeEpisode()];
    const forward = (e: Event) =>
      void instances[0].api.playEpisode((e as CustomEvent).detail);
    window.addEventListener("hd:play-episode", forward);

    try {
      await act(async () => {
        usePlayerStore.setState({ queue: [a, b], queueIndex: 0, currentEpisode: a });
        usePlayerStore.getState().setDuration(10_800);
        Object.defineProperty(element, "duration", {
          value: 10_800,
          configurable: true,
        });
        element.dispatchEvent(new Event("ended"));
      });

      expect(usePlayerStore.getState().queueIndex).toBe(1);
      expect(armWatchdog).toHaveBeenCalledTimes(1);
      const armed = armWatchdog.mock.calls[0][0] as {
        url: string;
        episodeId: string;
      };
      expect(armed.url).toBe(b.sourceUrl);
      expect(armed.url).not.toBe(a.sourceUrl);
      expect(armed.episodeId).toBe(communityKey(b));
      expect(armed.episodeId).not.toBe(communityKey(a));
    } finally {
      window.removeEventListener("hd:play-episode", forward);
    }
  });

  it("hands the watchdog what the browser said went wrong", () => {
    // On Chromium a file with no decodable frames raises `error` rather than
    // reporting a short duration, so the duration-based advisory can never fire
    // there. `MediaError.message` is the only thing that separates an empty file
    // from an unreachable one on that engine — and it is only observable if this
    // listener actually reads it and passes it on.
    mountBoth();
    watching = true;
    Object.defineProperty(element, "error", {
      value: { code: 3, message: "DEMUXER_ERROR_COULD_NOT_OPEN" },
      configurable: true,
    });

    act(() => {
      element.dispatchEvent(new Event("error"));
    });

    expect(noteError).toHaveBeenCalledTimes(1);
    expect(noteError).toHaveBeenCalledWith(
      "decode-error",
      "code=3 DEMUXER_ERROR_COULD_NOT_OPEN",
    );
  });

  it("keeps the globals alive while one of the two instances unmounts", () => {
    mountBoth();

    instances.pop()!.unmount();
    expect(noteListenersDetached).not.toHaveBeenCalled();

    act(() => {
      element.dispatchEvent(new Event("canplay"));
    });
    expect(noteReady).toHaveBeenCalledTimes(1);
  });
});

describe("readyState is what distinguishes a stalled load from a playing show", () => {
  it("a primed element with no data is a first play, not a resume", async () => {
    mountBoth();
    const ep = makeEpisode();

    act(() => {
      usePlayerStore.getState().loadEpisode(ep, "");
      instances[0].api.primeEpisode(ep);
    });
    setReadyState(element, 0);

    await act(async () => {
      await instances[0].api.togglePlay();
    });

    expect(usePlayerStore.getState().loadState).toBe("loading");
  });
});
