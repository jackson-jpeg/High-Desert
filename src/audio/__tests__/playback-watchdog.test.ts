import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Guards the "a show just never starts" class of bug.
 *
 * A listener reported that shows sometimes don't start and assumed it was their
 * own mistake, because nothing in the app ever disagreed with them. Two things
 * have to hold for that not to recur: a load attempt that goes nowhere must
 * time out rather than hang forever, and it must reach a terminal `failed`
 * state that something visible is attached to.
 *
 * The retry-once-then-fail policy is the part with real branching, so it is
 * what's asserted here.
 */

vi.mock("@/services/stats/client", () => ({
  reportPlaybackFailure: vi.fn(),
}));
vi.mock("@/lib/utils/platform", () => ({
  uaClass: () => "desktop-chromium",
  isIOSDevice: () => false,
}));

import {
  armWatchdog,
  disarmWatchdog,
  isWatching,
  noteError,
  noteProgress,
  noteReady,
  noteUnplayable,
  noteWaiting,
  setFailureHandler,
  __testing,
} from "../playback-watchdog";
import { reportPlaybackFailure } from "@/services/stats/client";

const { LOAD_TIMEOUT_MS, STALL_TIMEOUT_MS, withCacheBuster } = __testing;

const URL_A = "https://archive.org/download/coll/show.mp3";

/** Enough of an HTMLAudioElement for the watchdog's retry path. */
function fakeAudio() {
  return {
    src: "",
    currentTime: 0,
    removeAttribute: vi.fn(function (this: { src: string }) {
      this.src = "";
    }),
    load: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
  } as unknown as HTMLAudioElement & { play: ReturnType<typeof vi.fn> };
}

function arm(audio: HTMLAudioElement, episodeId: string | null = "coll--show") {
  armWatchdog({ audio, url: URL_A, episodeId, startAt: 42 });
}

describe("playback watchdog", () => {
  let onFail: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    onFail = vi.fn();
    setFailureHandler(onFail);
  });

  afterEach(() => {
    disarmWatchdog();
    vi.useRealTimers();
  });

  it("retries once on load timeout, then fails", () => {
    const audio = fakeAudio();
    arm(audio);

    // First timeout: silent retry, nothing surfaced to the user yet.
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);
    expect(onFail).not.toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.src).toContain("hd_retry=1");
    // The retry must resume where the listener was, not restart the show.
    expect(audio.currentTime).toBe(42);

    // Second timeout: out of retries.
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail).toHaveBeenCalledWith("timeout");
  });

  it("treats a persistent wait as a stall", () => {
    const audio = fakeAudio();
    arm(audio);

    noteWaiting();
    vi.advanceTimersByTime(STALL_TIMEOUT_MS);
    expect(audio.play).toHaveBeenCalledTimes(1); // retried

    noteWaiting();
    vi.advanceTimersByTime(STALL_TIMEOUT_MS);
    expect(onFail).toHaveBeenCalledWith("stall");
  });

  it("does not call a stall a stall when bytes are still arriving", () => {
    const audio = fakeAudio();
    arm(audio);

    noteWaiting();
    vi.advanceTimersByTime(STALL_TIMEOUT_MS - 1000);
    noteProgress(); // data arrived — this is slow, not stuck
    vi.advanceTimersByTime(STALL_TIMEOUT_MS - 1000);

    expect(audio.play).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
  });

  it("leaves a slow-but-moving download alone indefinitely", () => {
    const audio = fakeAudio();
    arm(audio);

    // A 70MB show trickling in over a weak connection. Well past the load
    // deadline in total, but never silent — interrupting this would throw away
    // everything buffered and turn slow into broken.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(LOAD_TIMEOUT_MS - 2000);
      noteProgress();
    }

    expect(audio.play).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
  });

  it("still gives up once a download that was moving goes silent", () => {
    const audio = fakeAudio();
    arm(audio);

    vi.advanceTimersByTime(LOAD_TIMEOUT_MS - 2000);
    noteProgress();
    // ...and then the connection dies without an error event.
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);
    expect(audio.play).toHaveBeenCalledTimes(1); // retried
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);
    expect(onFail).toHaveBeenCalledWith("timeout");
  });

  it("spends the retry immediately on a hard error", () => {
    const audio = fakeAudio();
    arm(audio);

    noteError("network-error");
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(onFail).not.toHaveBeenCalled();

    noteError("network-error");
    expect(onFail).toHaveBeenCalledWith("network-error");
  });

  it("does not retry a file that arrived intact and holds no audio", () => {
    const audio = fakeAudio();
    arm(audio);

    noteUnplayable("empty-media");

    // Re-fetching returns the same bytes. A retry here buys nothing but another
    // twelve seconds of the listener waiting on a file that will never play.
    expect(audio.play).not.toHaveBeenCalled();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail).toHaveBeenCalledWith("empty-media");
    expect(isWatching()).toBe(false);
    expect(reportPlaybackFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "empty-media", retried: false, recovered: false }),
    );
  });

  it("stops watching once the element is ready", () => {
    const audio = fakeAudio();
    arm(audio);
    expect(isWatching()).toBe(true);

    noteReady();
    expect(isWatching()).toBe(false);

    vi.advanceTimersByTime(LOAD_TIMEOUT_MS * 3);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("reports a retry that worked, so a flaky episode is still visible", () => {
    const audio = fakeAudio();
    arm(audio);

    vi.advanceTimersByTime(LOAD_TIMEOUT_MS); // retry
    noteReady(); // and it worked

    expect(onFail).not.toHaveBeenCalled();
    expect(reportPlaybackFailure).toHaveBeenCalledWith(
      expect.objectContaining({ retried: true, recovered: true }),
    );
  });

  it("reports nothing for episodes with no community key", () => {
    const audio = fakeAudio();
    arm(audio, null); // a local file

    vi.advanceTimersByTime(LOAD_TIMEOUT_MS * 2);
    expect(onFail).toHaveBeenCalled();
    expect(reportPlaybackFailure).not.toHaveBeenCalled();
  });

  it("disarming abandons the attempt silently", () => {
    const audio = fakeAudio();
    arm(audio);

    disarmWatchdog();
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS * 3);

    expect(onFail).not.toHaveBeenCalled();
    expect(reportPlaybackFailure).not.toHaveBeenCalled();
  });

  describe("cache buster", () => {
    it("adds a query param", () => {
      expect(withCacheBuster(URL_A, 1)).toBe(`${URL_A}?hd_retry=1`);
    });

    it("does not produce a second '?' on a url that already has one", () => {
      const out = withCacheBuster("https://x.test/a.mp3?token=1", 1);
      expect(out.match(/\?/g)).toHaveLength(1);
      expect(out).toContain("token=1");
      expect(out).toContain("hd_retry=1");
    });
  });
});
