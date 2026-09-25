import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * HD-016: a position save must not wake the library.
 *
 * When position lived on the episode row, every save — every 30 s while
 * playing, and on each pause and page hide — was a write to `db.episodes`, and
 * so re-ran every live query over the whole table: the library's list, facets,
 * smart playlists, stats. It now goes to `progress`.
 *
 * Driven for real: the library's actual episodes query
 * (`useLibraryEpisodes`, what /library renders from) mounted against a real
 * (fake-indexeddb) database, and the player's actual persistence installs
 * (`installPositionPersistence`, `installUnloadFlush`) doing the saving. Only
 * `setInterval`/`clearInterval` are faked, so Dexie's own scheduling is real.
 *
 * The CONTROL matters as much as the assertion: an ordinary `episodes` write
 * (a favourite) must wake the same probe. Without it, "the render count did not
 * move" is equally what a probe that never subscribed would report.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/services/stats/client", () => ({
  reportPlay: vi.fn(),
  reportStop: vi.fn(),
  reportStopBeacon: vi.fn(),
}));

const { db } = await import("@/db");
const { useLibraryEpisodes } = await import("@/hooks/library/useLibraryEpisodes");
const { installPositionPersistence, installUnloadFlush, POSITION_SAVE_MS } = await import(
  "@/hooks/player/persistence"
);
const { usePlayerStore } = await import("@/stores/player-store");
const { useProgressStore } = await import("@/stores/progress-store");

let renders = 0;
let lastCount = -1;
function Probe() {
  const eps = useLibraryEpisodes();
  renders++;
  lastCount = eps?.length ?? -1;
  return null;
}

let root: Root;
let uninstall: (() => void)[] = [];

/** Let Dexie's promise chain and the live query's re-run settle inside act. */
async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const HASH = "archive:coll:1997-07-28.mp3";

beforeEach(async () => {
  await db.episodes.clear();
  await db.progress.clear();
  await db.history.clear();
  useProgressStore.getState().reset();
  const rows = Array.from({ length: 20 }, (_, i) => ({
    fileHash: i === 0 ? HASH : `archive:coll:${i}.mp3`,
    fileName: `${i}.mp3`,
    filePath: "",
    fileSize: 0,
    title: `Show ${i}`,
    airDate: `1997-01-${String(i + 1).padStart(2, "0")}`,
    source: "archive" as const,
    createdAt: 0,
    updatedAt: 0,
  }));
  await db.episodes.bulkAdd(rows as never);
  const ep = (await db.episodes.where("fileHash").equals(HASH).first())!;
  usePlayerStore.setState({ currentEpisode: ep, playing: false, position: 0 });

  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  renders = 0;
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  await settle();
  expect(lastCount).toBe(20);
});

afterEach(() => {
  for (const u of uninstall) u();
  uninstall = [];
  act(() => root.unmount());
  vi.useRealTimers();
  usePlayerStore.setState({ currentEpisode: null, playing: false, position: 0 });
});

describe("position saves leave the library's episodes query asleep (HD-016)", () => {
  it("interval saves and the pause save write progress, and the library does not re-render", async () => {
    uninstall.push(installPositionPersistence());
    const before = renders;

    act(() => usePlayerStore.setState({ playing: true, position: 100 }));
    act(() => { vi.advanceTimersByTime(POSITION_SAVE_MS); });
    await settle();
    expect((await db.progress.get(HASH))?.playbackPosition).toBe(100);

    act(() => usePlayerStore.setState({ position: 250 }));
    act(() => { vi.advanceTimersByTime(POSITION_SAVE_MS); });
    await settle();
    expect((await db.progress.get(HASH))?.playbackPosition).toBe(250);

    act(() => usePlayerStore.setState({ position: 300, playing: false })); // the pause save
    await settle();
    expect((await db.progress.get(HASH))?.playbackPosition).toBe(300);

    expect(renders).toBe(before);
  });

  it("the unload flush writes progress, and the library does not re-render", async () => {
    uninstall.push(installUnloadFlush());
    const before = renders;
    act(() => usePlayerStore.setState({ playing: true, position: 777 }));
    window.dispatchEvent(new Event("pagehide"));
    await expect.poll(async () => (await db.progress.get(HASH))?.playbackPosition).toBe(777);
    await settle();
    expect(renders).toBe(before);
  });

  it("CONTROL: an episodes write does wake the same query", async () => {
    const before = renders;
    const ep = (await db.episodes.where("fileHash").equals(HASH).first())!;
    await act(async () => {
      await db.episodes.update(ep.id!, { favoritedAt: 1 });
    });
    await settle();
    expect(renders).toBeGreaterThan(before);
  });
});
