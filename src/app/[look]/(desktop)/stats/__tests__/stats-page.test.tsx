import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode, HistoryEntry } from "@/db/schema";

/**
 * /stats as rendered: the tiles show what computeLibraryStats computes from
 * the rows in IndexedDB, and the drill-downs land on the sort whose numbers
 * they show (Part 1D). library-stats.test.ts proves the arithmetic; this proves
 * the page shows *that* arithmetic rather than a second copy of it.
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

const tile = (label: string) => host.querySelector<HTMLElement>(`[data-stat="${label}"]`)!;

describe("/stats", () => {
  it("Listened is heard time (3.5h across 2 episodes), not the sum of positions (4.4h across 2)", async () => {
    await render();
    expect(tile("Listened").textContent).toContain("3.5h");
    expect(tile("Listened").textContent).toContain("2 episodes");
  });

  it("the Archive tiles and the undated row", async () => {
    await render();
    expect(tile("Episodes").textContent).toContain("4");
    expect(tile("Notable").textContent).toContain("2");
    expect(tile("Runtime").textContent).toContain("9h");
    expect(host.querySelector("[data-undated]")?.getAttribute("data-undated")).toBe("1");
  });

  it("My Most Played shows the plays it is ranked by, and drills into My plays", async () => {
    await render();
    const list = host.querySelector('[data-testid="my-most-played"]')!;
    const plays = [...list.querySelectorAll("[data-plays]")].map((e) => Number(e.getAttribute("data-plays")));
    expect(plays).toEqual([7, 3, 1]);
    expect(list.textContent).not.toContain("%");

    const more = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("sorted by My plays"))!;
    act(() => more.click());
    expect(push).toHaveBeenCalledWith("/library?sort=my-plays");
  });

  it("Avg Rating drills into My rating", async () => {
    await render();
    act(() => tile("Avg Rating").click());
    expect(push).toHaveBeenCalledWith("/library?sort=my-rating");
  });
});
