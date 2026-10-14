import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode, HistoryEntry } from "@/db/schema";

/**
 * /stats when IndexedDB does not answer (2026-10-13): another tab holds a
 * readwrite transaction over `history`, the page ends in an error with Retry,
 * and Retry recovers once the hold ends. Its own file: Dexie serves a live
 * query from its cache while an identical one is subscribed, so after
 * stats-page.test.tsx's renders the hold would never be reached.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/stats",
  useSearchParams: () => new URLSearchParams(),
}));
// Server-backed widgets have their own suites; here they would only fetch.
vi.mock("@/components/library/OnAir", () => ({ OnAir: () => null }));
vi.mock("@/components/library/SignalTraffic", () => ({ SignalTraffic: () => null }));
vi.mock("@/components/library/CommunityLeaderboard", () => ({ CommunityLeaderboard: () => null }));
vi.mock("@/components/library/PlaybackFailures", () => ({ PlaybackFailures: () => null }));
vi.mock("@/components/library/SmartPlaylists", () => ({ SmartPlaylists: () => null }));
vi.mock("@/components/library/HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("@/audio/cache", () => ({ getCacheSize: () => Promise.resolve(0), clearAudioCache: vi.fn() }));

const { db } = await import("@/db");
const { default: StatsPage } = await import("../page");
const { setDbWaitMsForTests } = await import("@/hooks/useTimedLiveQuery");

const EPISODES: Episode[] = [
  { title: "A", airDate: "1995-03-01", duration: 10_800, showType: "coast", playCount: 3, rating: 5, aiNotable: true, playbackPosition: 0 },
  { title: "B", airDate: "1997-09-11", duration: 10_800, showType: "coast", playCount: 7, rating: 2, playbackPosition: 9_000 },
  { title: "C", airDate: "2003-01-01", duration: 7_200, showType: "dreamland", aiNotable: true, playbackPosition: 7_000 },
  { title: "D", duration: 3_600, showType: "special", playCount: 1 },
].map((e, i) => ({ fileName: `${i}.mp3`, fileHash: `archive:c:${i}.mp3`, createdAt: 0, updatedAt: 0, ...e }) as Episode);

let root: Root;
let host: HTMLDivElement;

beforeAll(async () => {
  const ids = (await db.episodes.bulkAdd(EPISODES, { allKeys: true })) as number[];
  const history: HistoryEntry[] = [
    { episodeId: ids[0], timestamp: 1, duration: 10_800 }, // finished A: position back at 0
    { episodeId: ids[1], timestamp: 2, duration: 1_800 },
  ];
  await db.history.bulkAdd(history);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  push.mockClear();
});

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<StatsPage />));
  await expect.poll(() => host.textContent, { timeout: 10_000 }).toContain("Your Listening");
}


describe("/stats when the database does not answer (2026-10-13)", () => {
  /** Another tab's readwrite transaction over history, kept alive until released. */
  async function holdHistory() {
    const conn = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(db.name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    let holding = true;
    const tx = conn.transaction(["history"], "readwrite");
    const done = new Promise<void>((r) => { tx.oncomplete = () => r(); tx.onabort = () => r(); });
    const store = tx.objectStore("history");
    const spin = () => { if (holding) store.count().onsuccess = spin; };
    spin();
    return async () => { holding = false; await done; conn.close(); };
  }

  it("ends in an error with Retry instead of Loading station data forever, and Retry recovers", async () => {
    setDbWaitMsForTests(200);
    try {
      const release = await holdHistory();
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      act(() => root.render(<StatsPage />));
      expect(host.textContent).toContain("Loading station data");
      await expect.poll(() => host.querySelector('[data-testid="load-timeout"]'), { timeout: 5_000 }).not.toBeNull();
      expect(host.textContent).not.toContain("Loading station data");
      expect(host.textContent).toContain("Your listening stats is taking too long to load.");
      expect(host.textContent).not.toMatch(/—/);
      await release();
      act(() => host.querySelector<HTMLButtonElement>('[data-testid="load-timeout-retry"]')!.click());
      await expect.poll(() => host.textContent, { timeout: 5_000 }).toContain("Your Listening");
      expect(host.querySelector('[data-testid="load-timeout"]')).toBeNull();
    } finally {
      setDbWaitMsForTests(null);
    }
  }, 15_000);

  it("control: with nothing holding it, the page never shows the error", async () => {
    setDbWaitMsForTests(200);
    try {
      await render();
      await new Promise((r) => setTimeout(r, 400));
      expect(host.querySelector('[data-testid="load-timeout"]')).toBeNull();
    } finally {
      setDbWaitMsForTests(null);
    }
  });
});
