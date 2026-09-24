import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";
import type { SortMode } from "@/lib/library/filter-episodes";

/**
 * The list as the listener reads it: under a numeric sort, the metric column
 * shows the number the rows are ordered by — community plays under "Most
 * played", this browser's under "My plays" — and every group header's count
 * is the number of rows beneath it. The report: a "Played 2–4 times (2)"
 * header over rows reading 41, 6, 78, 120, 27, 20, 132.
 *
 * The real sortEpisodes feeds the real TimelineView; nothing of either is
 * mocked. Local and community numbers are built to disagree.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useMediaQuery: () => false,
}));
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { TimelineView } = await import("@/components/library/TimelineView");
const { sortEpisodes } = await import("@/lib/library/filter-episodes");
const { communityKey } = await import("@/lib/utils/community-key");

// Twelve shows. Community plays spread over several buckets; local plays
// run the opposite way.
const COMMUNITY_PLAYS = [41, 6, 78, 120, 27, 20, 132, 3, 1, 55, 0, 9];
const rows: Episode[] = COMMUNITY_PLAYS.map((_, i) => ({
  id: i + 1,
  fileHash: `archive:coll:${i + 1}.mp3`,
  fileName: `${i + 1}.mp3`,
  archiveIdentifier: "coll",
  title: `Show ${i + 1}`,
  airDate: `1999-01-${String(28 - i).padStart(2, "0")}`,
  playCount: i % 4 === 0 ? 0 : i,
})) as Episode[];
const community = new Map(
  rows.map((e, i) => [communityKey(e)!, { plays: COMMUNITY_PLAYS[i], avg: 0, count: 0 }]),
);

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  // Tall enough that all twelve rows and their headers render.
  Object.defineProperty(host, "clientHeight", { value: 2000 });
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(sortMode: SortMode) {
  const episodes = sortEpisodes(rows, sortMode, null, community);
  act(() => {
    root.render(createElement(TimelineView, { episodes, sortMode, community, onEpisodeClick: () => {} }));
  });
  return episodes;
}

/** The metric column, in DOM (= list) order, as numbers; blank is 0. */
function column(): number[] {
  return [...host.querySelectorAll<HTMLElement>("[data-metric]")]
    .filter((el) => el.closest(".md\\:grid"))
    .map((el) => Number((el.textContent ?? "").replace(/[^\d]/g, "") || 0));
}

function headers(): { key: string; count: number; rows: number }[] {
  const listbox = host.querySelector('[role="listbox"]')!;
  const tops = (el: Element) => parseFloat((el as HTMLElement).style.top);
  const hs = [...listbox.querySelectorAll('[data-testid="group-header"]')].sort((a, b) => tops(a) - tops(b));
  const rowEls = [...listbox.querySelectorAll('[role="option"]')].map((o) => o.closest<HTMLElement>(".absolute")!);
  return hs.map((h, i) => {
    const from = tops(h);
    const to = i + 1 < hs.length ? tops(hs[i + 1]) : Infinity;
    return {
      key: (h as HTMLElement).dataset.group!,
      count: Number((h as HTMLElement).dataset.count),
      rows: rowEls.filter((r) => tops(r) > from && tops(r) < to).length,
    };
  });
}

describe("the metric column and group headers", () => {
  it("Most played: the column is community plays, descending — not 41, 6, 78, 120…", () => {
    mount("played");
    const col = column();
    expect(col).toEqual([...COMMUNITY_PLAYS].sort((a, b) => b - a));
    expect(host.textContent).toContain("Plays");
  });

  it("My plays: the column is this browser's plays, descending, under a 'My plays' heading", () => {
    const episodes = mount("my-plays");
    expect(column()).toEqual(episodes.map((e) => e.playCount ?? 0));
    expect(column()).toEqual([...column()].sort((a, b) => b - a));
    expect(host.textContent).toContain("My plays");
  });

  for (const mode of ["played", "my-plays"] as const) {
    it(`${mode}: every group has a header, and each header's count is its rows`, () => {
      const episodes = mount(mode);
      const hs = headers();
      expect(hs.length).toBeGreaterThan(1);
      for (const h of hs) expect(h.count, h.key).toBe(h.rows);
      expect(hs.reduce((n, h) => n + h.count, 0)).toBe(episodes.length);
    });
  }
});
