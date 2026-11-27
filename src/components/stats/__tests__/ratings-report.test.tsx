import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RatingsReport as Report } from "@/services/stats/client";

/**
 * The Station tab's ratings report (UI plan push 6, batch 4): every line from
 * the server's own numbers, left out when there are none.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let report: Report | null = null;
vi.mock("@/services/stats/client", () => ({
  fetchRatingsReport: () => Promise.resolve(report),
}));
vi.mock("@/hooks/useCommunityKeyIndex", () => ({ useCommunityKeyIndex: () => new Map() }));

const { RatingsReport, crowdLine, sinceLabel } = await import("../RatingsReport");

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  host?.remove();
});

async function render() {
  const h = document.createElement("div");
  document.body.appendChild(h);
  const r = createRoot(h);
  host = h;
  root = r;
  await act(async () => r.render(<RatingsReport />));
  await act(async () => {});
  return h;
}

const EMPTY: Report = { crowd: null, week: [], newStates: [], finished: { since: "2026-11-28T00:00:00Z", minPlays: 5, entries: [] } };

describe("RatingsReport", () => {
  it("a full week: crowd, hottest, new states, Most played beside Most finished", async () => {
    report = {
      crowd: { peak: 12, typical: 6, days: 28 },
      week: [{ episodeId: "zz_key_area", plays: 40, title: "Area 51" }, { episodeId: "k3", plays: 12, title: "Dreamland" }],
      newStates: [{ region: "Ohio", code: "OH" }, { region: "Maine", code: "ME" }],
      finished: { since: "2026-11-28T00:00:00Z", minPlays: 5, entries: [{ episodeId: "k2", plays: 10, finishes: 7, share: 0.7, title: "Mel's Hole" }] },
    };
    const h = await render();
    const part = (k: string) => h.querySelector(`[data-report="${k}"]`)?.textContent ?? null;
    expect(part("crowd")).toContain("12 listeners at the peak");
    expect(part("crowd")).toContain("above a typical day's 6");
    expect(part("hottest")).toContain("Area 51");
    expect(part("hottest")).toContain("40 plays");
    expect(part("new-states")).toContain("Ohio, Maine");
    expect(part("most-played")).toContain("Area 51");
    expect(part("most-played")).toContain("Dreamland");
    // A show this browser's library lacks is named from the catalog, never by its key.
    expect(part("most-played")).not.toContain("zz_key_area");
    expect(part("most-finished")).toContain("Mel's Hole");
    expect(part("most-finished")).toContain("70%");
    expect(h.textContent).not.toContain("—");
  });

  it("not enough yet: no crowd, no hottest, and Most finished says what it is waiting for", async () => {
    report = EMPTY;
    const h = await render();
    expect(h.querySelector('[data-report="crowd"]')).toBeNull();
    expect(h.querySelector('[data-report="hottest"]')).toBeNull();
    expect(h.querySelector('[data-report="new-states"]')!.textContent).toContain("None new this week");
    expect(h.querySelector('[data-report="most-finished"]')!.textContent).toContain("Counting since Nov 28");
    expect(h.querySelector('[data-report="most-played"]')!.textContent).toContain("No plays this week yet");
  });

  it("no database: draws nothing", async () => {
    report = null;
    const h = await render();
    expect(h.querySelector('[data-testid="ratings-report"]')).toBeNull();
  });

  it("the crowd line compares honestly", () => {
    expect(crowdLine({ peak: 5, typical: 5, days: 9 })).toContain("about level with a typical day's 5");
    expect(crowdLine({ peak: 2, typical: 6, days: 9 })).toContain("below");
    expect(crowdLine({ peak: 1, typical: 0, days: 9 })).toBe("1 listener at the peak in the last 12 hours");
    expect(sinceLabel("2026-11-28T00:00:00Z")).toBe("Nov 28");
  });
});
