import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode, HistoryEntry } from "@/db/schema";

/**
 * "What reads broken" on /stats (UI plan push 6, batch 2): Your Listening
 * read 0.0h beside a 2-day streak and a history of plays. The tiles, the
 * streak and Listening History now read the same rows, real listens only,
 * so they agree. The real HistoryPanel, the real page, real Dexie.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/stats",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/library/CommunityLeaderboard", () => ({ CommunityLeaderboard: () => null }));
vi.mock("@/components/library/PlaybackFailures", () => ({ PlaybackFailures: () => null }));
vi.mock("@/components/library/SmartPlaylists", () => ({ SmartPlaylists: () => null }));

const { db } = await import("@/db");
const { default: StatsPage } = await import("../page");

const DAY = 86_400_000;
const today = new Date();
today.setHours(12, 0, 0, 0);
const noon = today.getTime();

const EPISODES: Episode[] = [
  { title: "Area 51", guestName: "Bob Lazar", airDate: "1989-11-11", duration: 10_800, showType: "coast" },
  { title: "Mel's Hole", guestName: "Mel Waters", airDate: "1997-02-21", duration: 10_800, showType: "coast" },
  { title: "Dreamland", airDate: "1999-01-01", duration: 7_200, showType: "dreamland" },
].map((e, i) => ({ fileName: `${i}.mp3`, fileHash: `archive:c:${i}.mp3`, createdAt: 0, updatedAt: 0, ...e }) as Episode);

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeAll(async () => {
  const [a, b] = (await db.episodes.bulkAdd(EPISODES, { allKeys: true })) as number[];
  const rows: HistoryEntry[] = [
    { episodeId: a, timestamp: noon - 2 * DAY, duration: 1_200, episodeTitle: "Area 51", guestName: "Bob Lazar" },
    { episodeId: a, timestamp: noon - DAY, duration: 1_800, episodeTitle: "Area 51", guestName: "Bob Lazar" },
    // Page loads that restored a show: written with 0 s before the fix.
    { episodeId: a, timestamp: noon, duration: 0, episodeTitle: "Area 51" },
    { episodeId: b, timestamp: noon - 5 * DAY, duration: 0, episodeTitle: "Mel's Hole" },
    // Put on and left after half a minute.
    { episodeId: b, timestamp: noon - 6 * DAY, duration: 30, episodeTitle: "Mel's Hole" },
  ];
  await db.history.bulkAdd(rows);
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  host?.remove();
});

async function render(tab: "you" | "archive", ready: string) {
  window.history.replaceState(null, "", `/stats?tab=${tab}`);
  const h = document.createElement("div");
  document.body.appendChild(h);
  const r = createRoot(h);
  host = h;
  root = r;
  act(() => r.render(<StatsPage />));
  await expect.poll(() => h.textContent, { timeout: 10_000 }).toContain(ready);
  return h;
}

describe("You: the tiles, the streak and the history agree", () => {
  it("Listened is the real listens: 50m across 1 show, not 0.0h and not the restores", async () => {
    const h = await render("you", "Listening History");
    const tile = (label: string) => h.querySelector<HTMLElement>(`[data-stat="${label}"]`)!;
    expect(tile("Listened").textContent).toContain("50m");
    expect(tile("Listened").textContent).toContain("1 show heard");
    // Yesterday and the day before: the restore today does not start a day.
    expect(tile("Streak").textContent).toContain("2d");
  });

  it("Listening History: one line for Area 51, played 2 times; Mel's Hole was never heard", async () => {
    const h = await render("you", "Listening History");
    const lines = [...h.querySelectorAll<HTMLElement>("[data-history-show]")];
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain("Area 51");
    expect(lines[0].getAttribute("data-plays")).toBe("2");
    expect(lines[0].textContent).toContain("played 2 times");
    expect(lines[0].textContent).toContain("50m heard");
    expect(h.textContent).not.toContain("Mel's Hole");
  });

  it("no Audio Cache on Stats (it is in the settings now)", async () => {
    const h = await render("you", "Listening History");
    expect(h.textContent).not.toContain("Audio Cache");
    expect(h.textContent).not.toContain("OPFS");
  });
});

describe("Archive: the Program Guide lists only kinds with shows", () => {
  it("no Uncategorized 0 row; the kinds that have shows stay", async () => {
    const h = await render("archive", "Program Guide");
    const guide = [...h.querySelectorAll("h2")].find((e) => e.textContent?.includes("Program Guide"))!.closest("div.flex.flex-col")!;
    expect(guide.textContent).toContain("Coast to Coast AM");
    expect(guide.textContent).toContain("Dreamland");
    expect(guide.textContent).not.toContain("Uncategorized");
    expect(guide.textContent).not.toContain("Specials");
  });
});
