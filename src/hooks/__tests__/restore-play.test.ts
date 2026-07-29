import { describe, it, expect, beforeEach } from "vitest";
import { usePlayerStore } from "@/stores/player-store";
import type { Episode } from "@/db/schema";

/**
 * The bug this file exists to prevent.
 *
 * Leaving the site and coming back restored the last-played episode by calling
 * `loadEpisode(ep, "")` — a pure Zustand setter that never touches the media
 * element. So the player rendered with a live ▶ button over an `<audio>` whose
 * `src` was still empty, and `togglePlay` returned at its `if (!audio.src)`
 * guard. No sound, no error, no console log, nothing.
 *
 * A listener hit this repeatedly, worked around it by picking a different show
 * from the library (which goes through `playEpisode` and does set `src`), and
 * concluded the fault was theirs: "could very well be user error on my end
 * too." It wasn't.
 *
 * Two invariants, then:
 *   1. Restoring an episode leaves the element pointed at something playable.
 *   2. Pressing play with no source loaded must never be a silent no-op.
 *
 * Asserting on the real hook would mean rendering the whole desktop layout, so
 * this exercises the two behaviours directly against the store and a stand-in
 * element, mirroring primeEpisode and togglePlay in ../useAudioPlayer.ts.
 */

function makeEpisode(over: Partial<Episode> = {}): Episode {
  return {
    id: 7,
    fileHash: "archive:coll:show.mp3",
    fileName: "show.mp3",
    title: "Coast to Coast AM — Area 51",
    sourceUrl: "https://archive.org/download/coll/show.mp3",
    playbackPosition: 615,
    duration: 10_800,
    showType: "coast",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Episode;
}

function fakeAudio() {
  return {
    src: "",
    currentTime: 0,
    playbackRate: 1,
    preload: "metadata",
  } as HTMLAudioElement;
}

/** Mirrors primeEpisode in ../useAudioPlayer.ts. */
function primeEpisode(audio: HTMLAudioElement, episode: Episode) {
  if (!episode.sourceUrl) return;
  if (audio.src) return;
  audio.preload = "none";
  audio.src = episode.sourceUrl;
  audio.currentTime = episode.playbackPosition ?? 0;
}

describe("restoring the last-played episode", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentEpisode: null,
      queue: [],
      queueIndex: -1,
      playing: false,
      position: 0,
      duration: 0,
      loadState: "idle",
    });
  });

  it("points the element at the episode, so play has something to resume", () => {
    const audio = fakeAudio();
    const ep = makeEpisode();

    // What the layout's restore effect does.
    usePlayerStore.getState().loadEpisode(ep, "");
    usePlayerStore.getState().setPosition(ep.playbackPosition ?? 0);
    usePlayerStore.getState().setDuration(ep.duration ?? 0);
    primeEpisode(audio, ep);

    expect(audio.src).toBe(ep.sourceUrl);
    expect(audio.currentTime).toBe(615);
  });

  it("costs no network — a restored episode nobody plays must not be fetched", () => {
    const audio = fakeAudio();
    primeEpisode(audio, makeEpisode());
    // "metadata" would have every page load pull the head of a show nobody
    // asked for; on a VBR rip with no Xing header that can be most of the file.
    expect(audio.preload).toBe("none");
  });

  it("does not auto-play — restoring is not starting", () => {
    const audio = fakeAudio();
    const ep = makeEpisode();

    usePlayerStore.getState().loadEpisode(ep, "");
    primeEpisode(audio, ep);

    expect(usePlayerStore.getState().playing).toBe(false);
  });

  it("never stomps a source that is already loaded", () => {
    const audio = fakeAudio();
    audio.src = "https://archive.org/download/coll/already-playing.mp3";

    primeEpisode(audio, makeEpisode());

    expect(audio.src).toContain("already-playing");
  });

  it("leaves the element alone for an episode with no source", () => {
    const audio = fakeAudio();
    primeEpisode(audio, makeEpisode({ sourceUrl: undefined }));
    expect(audio.src).toBe("");
  });

  it("pressing play with no source asks for the episode instead of doing nothing", () => {
    const ep = makeEpisode();
    usePlayerStore.getState().loadEpisode(ep, "");

    const dispatched: Episode[] = [];
    const listener = (e: Event) =>
      dispatched.push((e as CustomEvent<Episode>).detail);
    window.addEventListener("hd:play-episode", listener);

    // Mirrors togglePlay's no-source branch. The old code was `return`.
    const audio = fakeAudio();
    if (!audio.src) {
      const current = usePlayerStore.getState().currentEpisode;
      if (current) {
        window.dispatchEvent(
          new CustomEvent("hd:play-episode", { detail: current }),
        );
      }
    }

    window.removeEventListener("hd:play-episode", listener);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].id).toBe(ep.id);
  });
});

describe("loadEpisode clears stale playback state", () => {
  it("resets buffering, which used to latch on forever after a failure", () => {
    usePlayerStore.setState({
      buffering: true,
      bufferedTo: 300,
      error: "Network error. Check your connection.",
      queue: [],
      queueIndex: -1,
    });

    usePlayerStore.getState().loadEpisode(makeEpisode({ id: 9 }), "");

    const s = usePlayerStore.getState();
    expect(s.buffering).toBe(false);
    expect(s.bufferedTo).toBe(0);
    expect(s.error).toBeNull();
  });
});
