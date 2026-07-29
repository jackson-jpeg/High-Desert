import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSleepTimerStore } from "../sleep-timer-store";
import { usePlayerStore } from "../player-store";

/**
 * The sleep timer fades the volume over the last thirty seconds and then pauses.
 *
 * Two things here are easy to get wrong in ways nobody notices until it is 2am:
 * it must restore the pre-fade volume when it stops, or the app is permanently
 * quiet the next morning with no indication why; and its interval must be torn
 * down on cancel, or a cancelled timer goes on ticking and pauses playback later
 * for no visible reason.
 */

const t = () => useSleepTimerStore.getState();
const p = () => usePlayerStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
  t().cancel();
  usePlayerStore.setState({ playing: false, volume: 1, preMuteVolume: 1 });
});

afterEach(() => {
  t().cancel();
  vi.useRealTimers();
});

describe("starting and cancelling", () => {
  it("start(n) sets the remaining seconds and goes active", () => {
    t().start(30);
    expect(t().remaining).toBe(1800);
    expect(t().active).toBe(true);
  });

  it("start(0) cancels instead of arming a timer that fires immediately", () => {
    t().start(0);
    expect(t().active).toBe(false);
    expect(t().remaining).toBe(0);
  });

  it("a negative duration cancels too", () => {
    t().start(-5);
    expect(t().active).toBe(false);
  });

  it("counts down once per second", () => {
    t().start(2); // 120s
    vi.advanceTimersByTime(3000);
    expect(t().remaining).toBe(117);
  });

  it("cancel stops the interval — a cancelled timer must not keep ticking", () => {
    t().start(2);
    vi.advanceTimersByTime(1000);
    expect(t().remaining).toBe(119);

    t().cancel();
    expect(t().active).toBe(false);
    expect(t().remaining).toBe(0);

    // The tell: if the interval survived, `tick` would keep running against a
    // cancelled timer and could pause playback minutes later.
    vi.advanceTimersByTime(10_000);
    expect(t().remaining).toBe(0);
    expect(t().active).toBe(false);
  });

  it("restarting does not stack a second interval", () => {
    t().start(2);
    t().start(2);
    vi.advanceTimersByTime(1000);
    // Two intervals would take off two seconds.
    expect(t().remaining).toBe(119);
  });
});

describe("the fade and the stop", () => {
  /** An <audio> the store's `document.querySelector("audio")` will find. */
  function mountAudio() {
    const audio = document.createElement("audio");
    const pause = vi.fn();
    audio.pause = pause;
    document.body.appendChild(audio);
    return { audio, pause };
  }

  it("fades linearly over the last thirty seconds", () => {
    // Regression: the fade used to read the player's live volume back on every
    // tick, and `setVolume` writes `preMuteVolume` on every call — so the ramp
    // was multiplying its own output and decayed geometrically. At this point
    // it measured 0.7% instead of 50%.
    usePlayerStore.setState({ playing: true, volume: 1, preMuteVolume: 1 });
    t().start(1); // 60s

    vi.advanceTimersByTime(30_000); // -> 30 remaining, fade begins
    expect(t().remaining).toBe(30);
    expect(p().volume).toBeCloseTo(1, 5);

    vi.advanceTimersByTime(15_000); // -> 15
    expect(t().remaining).toBe(15);
    expect(p().volume).toBeCloseTo(0.5, 5);

    vi.advanceTimersByTime(9000); // -> 6
    expect(p().volume).toBeCloseTo(0.2, 5);
  });

  it("ramps from the listener's own volume, not from full", () => {
    usePlayerStore.setState({ playing: true, volume: 0.4, preMuteVolume: 0.4 });
    t().start(1);

    vi.advanceTimersByTime(45_000); // -> 15, half way through the ramp
    expect(p().volume).toBeCloseTo(0.2, 5);
  });

  it("does not touch the volume while paused", () => {
    usePlayerStore.setState({ playing: false, volume: 0.8, preMuteVolume: 0.8 });
    t().start(1);

    vi.advanceTimersByTime(45_000);
    expect(p().volume).toBe(0.8);
  });

  it("pauses playback and gives the volume back when it reaches zero", () => {
    const { audio, pause } = mountAudio();
    usePlayerStore.setState({ playing: true, volume: 0.8, preMuteVolume: 0.8 });
    t().start(1);

    vi.advanceTimersByTime(60_000);

    expect(t().active).toBe(false);
    expect(t().remaining).toBe(0);
    expect(p().playing).toBe(false);
    expect(pause).toHaveBeenCalled();
    // The one that bites the next morning: this used to come back as ~0.027.
    expect(p().volume).toBeCloseTo(0.8, 5);

    audio.remove();
  });

  it("leaves preMuteVolume intact, so unmuting still works afterwards", () => {
    // The second half of the same defect. `setVolume` tracks preMuteVolume, so
    // fading also destroyed the value `toggleMute` restores from — the listener
    // could not recover their volume by muting and unmuting either.
    const { audio } = mountAudio();
    usePlayerStore.setState({ playing: true, volume: 0.8, preMuteVolume: 0.8 });
    t().start(1);

    vi.advanceTimersByTime(60_000);

    p().toggleMute(); // -> 0
    expect(p().volume).toBe(0);
    p().toggleMute(); // -> back
    expect(p().volume).toBeCloseTo(0.8, 5);

    audio.remove();
  });

  it("hands the volume back when the timer is cancelled mid-fade", () => {
    usePlayerStore.setState({ playing: true, volume: 0.9, preMuteVolume: 0.9 });
    t().start(1);

    vi.advanceTimersByTime(50_000); // -> 10 remaining, well into the ramp
    expect(p().volume).toBeLessThan(0.9);

    t().cancel();
    // Changing your mind at 0:10 must not leave you at a third of the volume
    // you set, with the control that did it already gone from the UI.
    expect(p().volume).toBeCloseTo(0.9, 5);
  });

  it("leaves the volume alone when it expires without ever fading", () => {
    // Nothing was playing, so nothing was taken, so there is nothing to give
    // back. The old code assigned preMuteVolume unconditionally here, which
    // could move a slider the timer had never touched.
    usePlayerStore.setState({ playing: false, volume: 0.1, preMuteVolume: 0.7 });
    t().start(1);

    vi.advanceTimersByTime(60_000);

    expect(p().volume).toBe(0.1);
    expect(t().active).toBe(false);
  });
});
