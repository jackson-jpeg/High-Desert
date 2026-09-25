import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import type { Episode } from "@/db/schema";
import { mountHook, makeMediaElement, type Mounted } from "./support/mount-player";
import { archiveDownFixture, archiveUpFixture, resetOutage } from "@/test-support/outage";

/**
 * Outage mode on the play path, through the real hook, the real health module
 * and the real outage store. Only the element, IndexedDB and the stats client
 * are stubbed — and `fetch`, which never answers: whatever outage mode decides,
 * it must decide without waiting on the network. A refused start that needed
 * a response to be refused would hang here, not pass.
 *
 * Both start paths are covered (CLAUDE.md, "two start paths"): `playEpisode`
 * — the library, queue and radio — and the first ▶ of a restored show.
 */

const reportPlay = vi.fn();
let element: HTMLAudioElement;
const playCalls = vi.fn();

vi.mock("@/services/stats/client", () => ({
  reportPlay: (...a: unknown[]) => reportPlay(...a),
  reportStop: vi.fn(),
  reportStopBeacon: vi.fn(),
  reportPlaybackFailure: vi.fn(),
}));
vi.mock("@/audio/engine", () => ({
  getMediaElement: () => element,
  initEngine: vi.fn(),
  setEngineVolume: vi.fn(),
  notifySourceChanged: vi.fn(),
  getAnalyserNode: () => null,
  resumeContext: () => Promise.resolve(),
  seekEngine: (t: number) => t,
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

const { useAudioPlayer } = await import("@/hooks/useAudioPlayer");
const { usePlayerStore } = await import("@/stores/player-store");
const { useOutageStore } = await import("@/stores/outage-store");
const { disarmWatchdog } = await import("@/audio/playback-watchdog");
const { clearHealthCache } = await import("@/services/archive/health");

type Api = ReturnType<typeof useAudioPlayer>;
let instances: Mounted<Api>[] = [];
const fetchSpy = vi.fn((..._a: unknown[]) => new Promise<Response>(() => {}));

const COLL = "ultimate-ultimate-art-bell-collection";
let seq = 0;
function episode(label: string): Episode {
  seq++;
  const fileName = `1997-09-${10 + (seq % 18)} - Coast to Coast AM - ${label} (${seq}).mp3`;
  return {
    id: 100 + seq,
    fileHash: `archive:${COLL}:${fileName}`,
    fileName,
    archiveIdentifier: COLL,
    title: label,
    sourceUrl: `https://archive.org/download/${COLL}/${encodeURIComponent(fileName)}`,
    duration: 10_800,
    createdAt: 0,
    updatedAt: 0,
  } as Episode;
}
const mirrorOf = (ep: Episode) => `${window.location.origin}/mirror/${encodeURIComponent(ep.fileHash)}`;

beforeEach(() => {
  vi.clearAllMocks();
  clearHealthCache();
  resetOutage();
  vi.stubGlobal("fetch", fetchSpy);
  element = makeMediaElement(() => {
    playCalls();
    return Promise.resolve();
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
  vi.unstubAllGlobals();
});

const api = () => instances[0].api;
const mirrorRequests = () => fetchSpy.mock.calls.filter(([u]) => String(u).includes("/mirror/"));

describe("up (archiveUpFixture)", () => {
  it("a start goes to archive.org, and nothing is refused — even for a show the mirror does not hold", async () => {
    const ep = episode("Unpinned");
    archiveUpFixture([]);
    await act(async () => {
      await api().playEpisode(ep);
    });
    expect(element.src).toBe(ep.sourceUrl);
    expect(usePlayerStore.getState().source).toBe("archive");
    expect(useOutageStore.getState().unavailable).toBeNull();
    expect(playCalls).toHaveBeenCalledTimes(1);
  });
});

describe("down (archiveDownFixture)", () => {
  it("an unpinned show is refused at once: the dialog's state is set before anything is awaited, and nothing is touched", () => {
    const playing = episode("Pinned, playing");
    const wanted = episode("Unpinned");
    archiveDownFixture([playing.fileHash]);
    usePlayerStore.setState({ currentEpisode: playing, playing: true, source: "mirror" });
    element.src = mirrorOf(playing);

    // Not awaited: the refusal must already be visible when the call returns
    // its promise — no request, no timer, no microtask stands between them.
    const t0 = performance.now();
    act(() => void api().playEpisode(wanted));
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(useOutageStore.getState().unavailable?.fileHash).toBe(wanted.fileHash);

    // Whatever was playing keeps playing.
    expect(element.src).toBe(mirrorOf(playing));
    expect(usePlayerStore.getState().currentEpisode?.fileHash).toBe(playing.fileHash);
    expect(usePlayerStore.getState().playing).toBe(true);
    expect(playCalls).not.toHaveBeenCalled();
    expect(reportPlay).not.toHaveBeenCalled();
    expect(mirrorRequests()).toEqual([]);
  });

  it("a pinned show goes straight to the mirror and plays", async () => {
    const ep = episode("Pinned");
    archiveDownFixture([ep.fileHash]);
    await act(async () => {
      await api().playEpisode(ep);
    });
    expect(element.src).toBe(mirrorOf(ep));
    expect(usePlayerStore.getState().source).toBe("mirror");
    expect(usePlayerStore.getState().playing).toBe(true);
    expect(useOutageStore.getState().unavailable).toBeNull();
  });

  it("with no manifest known, a start is sent to the mirror to find out — never refused on a guess", async () => {
    const ep = episode("Unknown");
    useOutageStore.setState({ archiveUp: false, manifest: null, unavailable: null });
    await act(async () => {
      await api().playEpisode(ep);
    });
    expect(element.src).toBe(mirrorOf(ep));
    expect(useOutageStore.getState().unavailable).toBeNull();
  });

  it("the first ▶ of a restored show the mirror lacks is refused the same way", async () => {
    const ep = episode("Restored, unpinned");
    archiveUpFixture();
    act(() => api().primeEpisode(ep));
    usePlayerStore.setState({ currentEpisode: ep });
    expect(element.src).toBe(ep.sourceUrl);

    archiveDownFixture([]);
    act(() => void api().togglePlay());
    expect(useOutageStore.getState().unavailable?.fileHash).toBe(ep.fileHash);
    expect(playCalls).not.toHaveBeenCalled();
    expect(reportPlay).not.toHaveBeenCalled();
  });

  it("the first ▶ of a restored show the mirror holds moves it to the mirror before play()", async () => {
    const ep = episode("Restored, pinned");
    archiveUpFixture();
    act(() => api().primeEpisode(ep));
    usePlayerStore.setState({ currentEpisode: ep });

    archiveDownFixture([ep.fileHash]);
    await act(async () => {
      await api().togglePlay();
    });
    expect(element.src).toBe(mirrorOf(ep));
    expect(usePlayerStore.getState().source).toBe("mirror");
    expect(playCalls).toHaveBeenCalledTimes(1);
  });

  it("archive.org returning closes the dialog", () => {
    const ep = episode("Unpinned");
    archiveDownFixture([]);
    act(() => void api().playEpisode(ep));
    expect(useOutageStore.getState().unavailable).not.toBeNull();
    act(() => useOutageStore.getState().setArchiveUp(true));
    expect(useOutageStore.getState().unavailable).toBeNull();
  });
});

describe("the play-episode handler's front door (admitRequestedStart)", () => {
  it("down: a show the mirror lacks is refused and never queued; one it holds is queued", async () => {
    const { admitRequestedStart } = await import("@/audio/outage-gate");
    const pinned = episode("Pinned");
    const unpinned = episode("Unpinned");
    archiveDownFixture([pinned.fileHash]);
    const enqueue = vi.fn();
    expect(admitRequestedStart(unpinned, enqueue)).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(useOutageStore.getState().unavailable?.fileHash).toBe(unpinned.fileHash);
    expect(admitRequestedStart(pinned, enqueue)).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(pinned);
  });

  it("up: everything is queued", async () => {
    const { admitRequestedStart } = await import("@/audio/outage-gate");
    archiveUpFixture([]);
    const enqueue = vi.fn();
    expect(admitRequestedStart(episode("Anything"), enqueue)).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
