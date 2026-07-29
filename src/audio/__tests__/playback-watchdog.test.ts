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
  noteListenersAttached,
  noteProgress,
  noteReady,
  noteSuspectDuration,
  noteUnplayable,
  noteWaiting,
  setFailureHandler,
  __testing,
} from "../playback-watchdog";
import { reportPlaybackFailure } from "@/services/stats/client";

const {
  LOAD_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  withCacheBuster,
  resetListeners,
} = __testing;

const URL_A = "https://archive.org/download/coll/show.mp3";

type FakeAudio = HTMLAudioElement & { play: ReturnType<typeof vi.fn> };

/**
 * Enough of an HTMLAudioElement for the watchdog's retry path.
 *
 * `paused` and `readyState` are not decoration. They are the difference between
 * "this load is stuck" and "this show is playing", and the watchdog now refuses
 * to tear down the second — the omission that let it interrupt working audio
 * twelve seconds in. The defaults model the state right after `play()` has been
 * called and before any data has arrived: not paused, nothing buffered.
 */
function fakeAudio(over: Partial<HTMLAudioElement> = {}): FakeAudio {
  return {
    src: "",
    currentTime: 0,
    paused: false,
    readyState: 0,
    removeAttribute: vi.fn(function (this: { src: string }) {
      this.src = "";
    }),
    load: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    ...over,
  } as unknown as FakeAudio;
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
    // The watchdog refuses to arm without this — see the "unwired" block below.
    resetListeners();
    noteListenersAttached();
  });

  afterEach(() => {
    disarmWatchdog();
    resetListeners();
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

  describe("it must never interrupt a show that is playing", () => {
    /**
     * The failure this prevents, in full: the media listeners were never
     * attached, so no `progress` event ever reset the deadline. Twelve seconds
     * into a broadcast that was streaming perfectly the watchdog fired, tore the
     * element down and re-assigned `src` — the show cut out and restarted from
     * the beginning, or on iOS stopped for good, and a phantom timeout was
     * recorded against an episode that was working.
     *
     * `noteProgress()` is the designed defence and is covered above. This is the
     * floor under it: a check that holds even when no signal arrives at all,
     * because that is precisely the case that went wrong.
     */
    const playing = { paused: false, readyState: 4 } as Partial<HTMLAudioElement>;

    it("stands down when the load deadline fires over audible playback", () => {
      const audio = fakeAudio(playing);
      arm(audio);

      vi.advanceTimersByTime(LOAD_TIMEOUT_MS * 3);

      expect(audio.play).not.toHaveBeenCalled(); // no teardown, no restart
      expect(audio.src).not.toContain("hd_retry");
      expect(onFail).not.toHaveBeenCalled();
      expect(reportPlaybackFailure).not.toHaveBeenCalled();
      expect(isWatching()).toBe(false);
    });

    it("stands down when the stall clock fires over audible playback", () => {
      const audio = fakeAudio(playing);
      arm(audio);

      noteWaiting();
      vi.advanceTimersByTime(STALL_TIMEOUT_MS * 3);

      expect(audio.play).not.toHaveBeenCalled();
      expect(onFail).not.toHaveBeenCalled();
    });

    it("records the recovery when a retry is what got it playing", () => {
      const audio = fakeAudio();
      arm(audio);

      vi.advanceTimersByTime(LOAD_TIMEOUT_MS); // retry fires
      // The retry worked, but `canplay` never reached us. The show is audibly
      // playing, so the second deadline must recognise that rather than fail it.
      Object.assign(audio, { paused: false, readyState: 4 });
      vi.advanceTimersByTime(LOAD_TIMEOUT_MS);

      expect(onFail).not.toHaveBeenCalled();
      expect(reportPlaybackFailure).toHaveBeenCalledWith(
        expect.objectContaining({ retried: true, recovered: true }),
      );
    });

    it("still fails a load that is merely unpaused with nothing buffered", () => {
      // `play()` clears `paused` synchronously, so paused===false alone means
      // "asked for", not "playing". readyState is what makes the difference.
      const audio = fakeAudio({ paused: false, readyState: 0 });
      arm(audio);

      vi.advanceTimersByTime(LOAD_TIMEOUT_MS * 2);

      expect(onFail).toHaveBeenCalledWith("timeout");
    });
  });

  describe("the retry must not start audio nobody asked for", () => {
    it("does not call play() on an element the listener has paused", () => {
      const audio = fakeAudio({ paused: true, readyState: 0 });
      arm(audio);

      vi.advanceTimersByTime(LOAD_TIMEOUT_MS);

      // The source is re-assigned so the load can be re-attempted, but a timer
      // must never be what starts a show. Pressing play is the listener's call.
      expect(audio.src).toContain("hd_retry=1");
      expect(audio.play).not.toHaveBeenCalled();
    });

    it("treats a refused retry as terminal, because it is", async () => {
      // On iOS the retry's play() runs inside a timer callback, outside the
      // user-activation chain, and Safari refuses it outright. Nothing gets that
      // back — the listener has to tap again. It used to stop the audio dead and
      // show nothing, because the handler this routes through was never
      // installed. Two of the recorded failures are exactly this.
      const audio = fakeAudio({
        play: vi.fn(() => Promise.reject(new DOMException("no", "NotAllowedError"))),
      });
      arm(audio);

      vi.advanceTimersByTime(LOAD_TIMEOUT_MS);
      await vi.waitFor(() => expect(onFail).toHaveBeenCalled());

      expect(onFail).toHaveBeenCalledWith("play-rejected");
    });
  });

  describe("a watchdog with no inputs must not report", () => {
    /**
     * The whole class, closed off. Every input this module has arrives from a
     * media element listener; for four months those listeners were never
     * installed and nothing here noticed, so it armed, saw no `progress`
     * because nothing was listening for it, ran the deadline out and reported a
     * timeout. A detector with no inputs cannot tell "nothing happened" from
     * "I cannot see" — so it now requires proof it is wired, and fails closed.
     */
    it("refuses to arm at all", () => {
      resetListeners(); // nothing attached
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const audio = fakeAudio();

      arm(audio);

      expect(isWatching()).toBe(false);
      vi.advanceTimersByTime(LOAD_TIMEOUT_MS * 3);
      expect(audio.play).not.toHaveBeenCalled();
      expect(onFail).not.toHaveBeenCalled();
      expect(reportPlaybackFailure).not.toHaveBeenCalled();
      expect(err).toHaveBeenCalled(); // and it says so, loudly
      err.mockRestore();
    });
  });

  describe("advisory duration reports", () => {
    it("records the reported duration without failing anything", () => {
      noteSuspectDuration("coll--show", 3.25);

      expect(reportPlaybackFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "empty-media-suspected",
          retried: false,
          recovered: false,
          detail: "duration=3.250",
        }),
      );
      expect(onFail).not.toHaveBeenCalled();
    });

    it("says nothing for a local file with no community key", () => {
      noteSuspectDuration(null, 3.25);
      expect(reportPlaybackFailure).not.toHaveBeenCalled();
    });
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
