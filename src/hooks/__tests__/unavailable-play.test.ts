import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import type { Episode } from "@/db/schema";
import { mountHook, makeMediaElement, type Mounted } from "./support/mount-player";
import { onHdEvent } from "@/lib/events";
import { REMOVED_FROM_CATALOG } from "@/lib/library/removed-episodes";

/**
 * Pressing play on an episode pulled from the catalog (docs/broken-episodes.md)
 * explains instead of asking archive.org for a file with no audio in it. The
 * real useAudioPlayer, mounted the way production mounts it: playEpisode is
 * where every start lands (library, queue advance, radio), and primeEpisode is
 * the restored-player path that would otherwise hand the element a source.
 */

let element: HTMLAudioElement;

vi.mock("@/services/stats/client", () => ({
  reportPlay: vi.fn(),
  reportStop: vi.fn(),
  reportStopBeacon: vi.fn(),
  reportPlaybackFailure: vi.fn(),
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
    episodes: { update: () => Promise.resolve(1) },
    userPrefs: { get: () => Promise.resolve(undefined), put: () => Promise.resolve() },
  },
}));
vi.mock("@/services/archive/health", () => ({
  checkArchiveHealth: () => Promise.resolve({ ok: true, up: true }),
  clearHealthCache: vi.fn(),
  archiveKnownDown: () => false,
}));

const { useAudioPlayer } = await import("@/hooks/useAudioPlayer");
const { usePlayerStore } = await import("@/stores/player-store");

const [PULLED_HASH] = REMOVED_FROM_CATALOG.keys();
const PULLED_URL =
  "https://archive.org/download/ultimate-ultimate-art-bell-collection/2002-03-19%20-%20Coast.mp3";

function makeEpisode(over: Partial<Episode> = {}): Episode {
  return {
    id: 1313,
    fileHash: PULLED_HASH,
    fileName: "2002-03-19 - Coast.mp3",
    title: "Coast to Coast AM - Climate Change",
    sourceUrl: PULLED_URL,
    showType: "coast",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Episode;
}

let player: Mounted<ReturnType<typeof useAudioPlayer>>;
const heard: Episode[] = [];
let off: () => void;

beforeEach(() => {
  element = makeMediaElement();
  heard.length = 0;
  off = onHdEvent("episode-unavailable", (ep) => heard.push(ep));
  usePlayerStore.setState({
    currentEpisode: null,
    queue: [],
    queueIndex: -1,
    playing: false,
    loadState: "idle",
    error: null,
  });
  player = mountHook(useAudioPlayer);
});

afterEach(() => {
  off();
  player.unmount();
});

describe("playing an episode pulled from the catalog", () => {
  it("never points the element at archive.org, and says why", async () => {
    await act(async () => {
      await player.api.playEpisode(makeEpisode());
    });
    expect(element.getAttribute("src")).toBeNull();
    expect(heard.map((e) => e.id)).toEqual([1313]);
    // Nothing became current, so whatever was playing is untouched.
    expect(usePlayerStore.getState().currentEpisode).toBeNull();
    expect(usePlayerStore.getState().loadState).toBe("idle");
  });

  it("leaves a show that is already playing alone", async () => {
    const other = makeEpisode({ id: 5, fileHash: "archive:coll:other.mp3", sourceUrl: "https://archive.org/download/coll/other.mp3" });
    await act(async () => {
      await player.api.playEpisode(other);
    });
    expect(element.getAttribute("src")).toBe(other.sourceUrl);
    await act(async () => {
      await player.api.playEpisode(makeEpisode());
    });
    expect(element.getAttribute("src")).toBe(other.sourceUrl);
    expect(usePlayerStore.getState().currentEpisode?.id).toBe(5);
  });

  it("a restored pulled episode is not primed with a source", () => {
    act(() => {
      player.api.primeEpisode(makeEpisode());
    });
    expect(element.getAttribute("src")).toBeNull();
  });

  it("control: the same show from any other source plays", async () => {
    const local = makeEpisode({ fileHash: "archive:someone-elses-upload:2002-03-19 - Coast.mp3" });
    await act(async () => {
      await player.api.playEpisode(local);
    });
    expect(element.getAttribute("src")).toBe(PULLED_URL);
    expect(heard).toEqual([]);
  });
});
