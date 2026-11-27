import "fake-indexeddb/auto";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";

/**
 * /stats's three tabs (UI plan push 6, batch 1): each panel holds what the
 * plan gives it and nothing from another, Station is the default, and the
 * URL and the tab follow each other.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/stats",
  useSearchParams: () => new URLSearchParams(),
}));
// Each server-backed widget is a marker: which panel draws it is the subject.
const marker = (name: string) => () => <section data-widget={name}>{name}</section>;
vi.mock("@/components/library/OnAir", () => ({ OnAir: marker("On Air") }));
vi.mock("@/components/library/SignalTraffic", () => ({ SignalTraffic: marker("Signal Traffic") }));
vi.mock("@/components/library/Listeners", () => ({ Listeners: marker("Listeners") }));
vi.mock("@/components/library/Supporters", () => ({ Supporters: marker("Supporters") }));
vi.mock("@/components/library/StationSponsors", () => ({ StationSponsors: marker("Station sponsors") }));
vi.mock("@/components/library/CommunityLeaderboard", () => ({ CommunityLeaderboard: marker("Community Top 20") }));
vi.mock("@/components/library/PlaybackFailures", () => ({ PlaybackFailures: () => null }));
vi.mock("@/components/library/SmartPlaylists", () => ({ SmartPlaylists: () => null }));
vi.mock("@/components/library/HistoryPanel", () => ({ HistoryPanel: marker("Listening History") }));
vi.mock("@/audio/cache", () => ({ getCacheSize: () => Promise.resolve(0), clearAudioCache: vi.fn() }));

const { db } = await import("@/db");
const { default: StatsPage } = await import("../page");
const { parseStatsTab, statsTabHref } = await import("@/lib/stats/tabs");
const { STATS_PATH } = await import("../../../../../../scripts/returning-visitor.mjs");

const EPISODES: Episode[] = [
  { title: "A", airDate: "1995-03-01", duration: 10_800, showType: "coast", playCount: 3, guestName: "John Lear", aiCategory: "UFOs" },
  { title: "B", airDate: "1997-09-11", duration: 10_800, showType: "coast", playCount: 7, guestName: "John Lear", aiCategory: "UFOs" },
].map((e, i) => ({ fileName: `${i}.mp3`, fileHash: `archive:c:${i}.mp3`, createdAt: 0, updatedAt: 0, ...e }) as Episode);

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeAll(async () => {
  await db.episodes.bulkAdd(EPISODES);
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  host?.remove();
  window.history.replaceState(null, "", "/");
});

async function render(url: string) {
  window.history.replaceState(null, "", url);
  const h = document.createElement("div");
  document.body.appendChild(h);
  const r = createRoot(h);
  host = h;
  root = r;
  act(() => r.render(<StatsPage />));
}

const widgets = () => [...host!.querySelectorAll("[data-widget]")].map((e) => e.getAttribute("data-widget"));
const headings = () => [...host!.querySelectorAll("h2")].map((e) => e.textContent?.trim());
const selected = () => host!.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-tab");

describe("the tab in the URL", () => {
  it("parses the three keys, and anything else is Station", () => {
    expect(parseStatsTab("?tab=you")).toBe("you");
    expect(parseStatsTab("?tab=archive")).toBe("archive");
    expect(parseStatsTab("")).toBe("station");
    expect(parseStatsTab("?tab=nonsense")).toBe("station");
    expect(statsTabHref("station")).toBe("/stats");
    expect(statsTabHref("archive")).toBe("/stats?tab=archive");
  });
});

describe("/stats's tabs", () => {
  it("Station is the default: the station's panels, nothing of yours or the catalog's", async () => {
    await render("/stats");
    expect(selected()).toBe("station");
    expect(widgets()).toEqual(["On Air", "Signal Traffic", "Listeners", "Supporters", "Station sponsors"]);
    expect(host!.textContent).not.toContain("Your Listening");
    expect(host!.textContent).not.toContain("The Archive");
    // Nothing waits on IndexedDB here.
    expect(host!.textContent).not.toContain("Loading station data");
  });

  it("?tab=you is this browser's listening, and only that", async () => {
    await render("/stats?tab=you");
    expect(selected()).toBe("you");
    await expect.poll(() => headings(), { timeout: 10_000 }).toContain("Your Listening");
    expect(headings()).toContain("My Most Played");
    expect(widgets()).toEqual(["Listening History"]);
    expect(headings()).not.toContain("The Archive");
  });

  it("?tab=archive is the catalog: The Archive, the charts, the guests, Community Top 20", async () => {
    await render("/stats?tab=archive");
    expect(selected()).toBe("archive");
    await expect.poll(() => headings(), { timeout: 10_000 }).toContain("The Archive");
    for (const h of ["Broadcast Log", "Program Guide", "Subject Breakdown", "Most-Featured Guests"]) expect(headings()).toContain(h);
    expect(widgets()).toEqual(["Community Top 20"]);
    expect(headings()).not.toContain("Your Listening");
    expect(headings()).not.toContain("My Most Played");
  });

  it("a click selects the tab and writes it into the URL; Station takes the parameter away", async () => {
    await render("/stats?viewer");
    const tab = (k: string) => host!.querySelector<HTMLButtonElement>(`[role="tab"][data-tab="${k}"]`)!;
    act(() => tab("archive").click());
    expect(selected()).toBe("archive");
    expect(window.location.search).toContain("tab=archive");
    expect(window.location.search).toContain("viewer");
    await expect.poll(() => headings(), { timeout: 10_000 }).toContain("The Archive");
    act(() => tab("station").click());
    expect(window.location.search).not.toContain("tab=");
    expect(widgets()).toContain("On Air");
  });

  it("the arrows move along the tabs (the ARIA tabs pattern), and only the selected one is in the Tab order", async () => {
    await render("/stats");
    const list = host!.querySelector('[role="tablist"]')!;
    act(() => list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(selected()).toBe("you");
    act(() => list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    act(() => list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(selected()).toBe("archive");
    const tabbable = [...host!.querySelectorAll('[role="tab"]')].filter((t) => t.getAttribute("tabindex") === "0");
    expect(tabbable.map((t) => t.getAttribute("data-tab"))).toEqual(["archive"]);
    const panel = host!.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute("aria-labelledby")).toBe(host!.querySelector('[aria-selected="true"]')!.id);
  });

  it("the deploy's returning-visitor check opens the tab that reads the library", async () => {
    // It waits for "Your Listening" as the sign IndexedDB answered; on the
    // default tab that window never draws and every deploy would roll back.
    await render(STATS_PATH);
    await expect.poll(() => headings(), { timeout: 10_000 }).toContain("Your Listening");
  });
});
