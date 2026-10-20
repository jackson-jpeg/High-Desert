import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SilentEventSource } from "@/test-support/event-source";

/**
 * The real Listeners panel, with only the network stubbed: the routes answer
 * in their documented shapes (docs/visitors.md) and the test reads what is on
 * screen, not the component's state.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("EventSource", SilentEventSource);

const { Listeners } = await import("@/components/library/Listeners");
const { resetNowFeedForTests } = await import("@/services/stats/now-feed");

const place = (countries: [string | null, string | null, number][], states: [string | null, string | null, number][]) => ({
  total: countries.reduce((s, [, , n]) => s + n, 0),
  countries: countries.map(([country, name, n]) => ({ country, name, n })),
  states: states.map(([region, code, n]) => ({ region, code, n })),
});

const VISITORS = {
  countingSince: "2026-09-27",
  totals: { visitors: 1234, browsers: 80, backfilled: 1154, hereBefore: 5, newThisWeek: 70, activeThisWeek: 150, returning: 114 },
  locations: {
    allTime: place([["US", "United States", 60], ["GB", "United Kingdom", 12], [null, null, 1162]], [["California", "CA", 30], ["Nevada", "NV", 3], [null, null, 27]]),
    week: place([["CA", "Canada", 4], ["US", "United States", 9]], [["Texas", "TX", 9]]),
    now: place([], []),
  },
  attribution: { text: "IP Geolocation by DB-IP", url: "https://db-ip.com" },
};
const FEED = {
  entries: [
    { at: new Date(Date.now() - 120_000).toISOString(), country: "US", name: "United States", region: "Nevada", code: "NV", city: null },
    { at: new Date(Date.now() - 600_000).toISOString(), country: "CA", name: "Canada", region: "Ontario", code: null, city: null },
    { at: new Date().toISOString(), country: null, name: null, region: null, code: null, city: null },
  ],
  attribution: VISITORS.attribution,
};
const RECORDS = {
  biggestCrowd: { online: 38, listening: 26, at: "2026-09-27T03:20:00.000Z", day: "2026-09-27", since: "2026-09-24" },
  biggestDay: { day: "2026-09-27", plays: 1100 },
  biggestArrivalDay: { day: "2026-09-27", visitors: 286 },
  mostPlayed: { episodeId: "x", plays: 278, title: "Coast to Coast AM - Cosmology & Consciousness" },
};

let root: Root;
let host: HTMLDivElement;
let available = true;
/** What /api/stats/visitors answers; a test swaps it, then a poll reads it. */
let visitors: typeof VISITORS = VISITORS;

async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}

beforeEach(() => {
  available = true;
  visitors = VISITORS;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (!available && !url.startsWith("/api/stats/now")) return new Response("{}", { status: 503 });
      if (url.startsWith("/api/stats/visitors")) return json(visitors);
      if (url.startsWith("/api/stats/tuning-in")) return json(FEED);
      if (url.startsWith("/api/stats/records")) return json(RECORDS);
      if (url.startsWith("/api/stats/now")) return json({ online: 4, listening: 2, live: 1, onAir: [], recent: [] });
      return new Response("{}", { status: 404 });
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.stubGlobal("EventSource", SilentEventSource);
  resetNowFeedForTests();
});

const q = (id: string) => host.querySelector(`[data-testid="${id}"]`);
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const pressed = () => [...host.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent);

/** `placed` of `total` all time and this week; the rest in the unknown bucket. */
function withPlaced(allTime: [number, number], week: [number, number]): typeof VISITORS {
  const p = ([placed, total]: [number, number]) =>
    place([["US", "United States", placed], ...(total > placed ? [[null, null, total - placed] as [null, null, number]] : [])], [["Nevada", "NV", placed]]);
  return { ...VISITORS, locations: { ...VISITORS.locations, allTime: p(allTime), week: p(week) } };
}

/** A poll: coming back on screen reads all three routes at once (useListeners). */
async function poll() {
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await flush();
}

describe("Listeners panel", () => {
  it("leads with everyone counted once, and what it counts from", async () => {
    act(() => root.render(<Listeners />));
    await flush();
    expect(q("listeners-total")?.textContent).toBe("1,234");
    expect(host.textContent).toContain("listeners since 27 Sep 2026");
    expect(host.textContent).toContain("150 this week");
    expect(host.textContent).toContain("114 came back another day");
    expect(host.querySelector('[data-presence="listeners"]')?.textContent).toContain("4 here now");
  });

  it("all time: states on the map by count, the unplaced said once, countries ranked", async () => {
    act(() => root.render(<Listeners />));
    await flush();
    act(() => button("All time").click());
    const map = q("listeners-map")!;
    expect(map.querySelector('[data-state="CA"]')?.getAttribute("data-tier")).toBe("4");
    expect(map.querySelector('[data-state="NV"]')?.getAttribute("data-tier")).toBe("2");
    expect(map.querySelector('[data-state="ME"]')?.getAttribute("data-tier")).toBe("0");
    const states = q("listeners-states")!;
    expect([...states.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["California30", "Nevada3"]);
    expect(states.textContent).toContain("27 listeners not placed");
    const countries = q("listeners-countries")!;
    expect([...countries.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["United States60", "United Kingdom12"]);
  });

  it("switching the period redraws from that period's numbers", async () => {
    act(() => root.render(<Listeners />));
    await flush();
    const week = [...host.querySelectorAll("button")].find((b) => b.textContent === "This week")!;
    act(() => week.click());
    expect(week.getAttribute("aria-pressed")).toBe("true");
    expect([...q("listeners-countries")!.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["United States9", "Canada4"]);
    expect(q("listeners-map")!.querySelector('[data-state="TX"]')?.getAttribute("data-tier")).toBe("4");
    expect(q("listeners-map")!.querySelector('[data-state="CA"]')?.getAttribute("data-tier")).toBe("0");

    const nowBtn = [...host.querySelectorAll("button")].find((b) => b.textContent === "Right now")!;
    act(() => nowBtn.click());
    expect(host.textContent).toContain("Nobody is on the site this minute");
    expect(q("listeners-map")).toBeNull();
  });

  it("the feed names places, newest first, and skips a line with no country", async () => {
    act(() => root.render(<Listeners />));
    await flush();
    const lines = [...q("listeners-feed")!.querySelectorAll("li")].map((li) => li.textContent);
    expect(lines).toEqual(["Nevada2 min ago", "Ontario, Canada10 min ago"]);
  });

  it("the records, and the credit the geo licence asks for", async () => {
    act(() => root.render(<Listeners />));
    await flush();
    const rec = q("listeners-records")!;
    expect(rec.textContent).toContain("38");
    expect(rec.textContent).toContain("Biggest crowd");
    expect(rec.textContent).toContain("1,100");
    expect(rec.textContent).toContain("286");
    expect(q("listeners-most-played")?.textContent).toContain("Cosmology & Consciousness");
    expect(q("listeners-most-played")?.textContent).toContain("278 plays");
    const credit = host.querySelector('a[href="https://db-ip.com"]');
    expect(credit?.textContent).toBe("IP Geolocation by DB-IP");
    expect(host.textContent).toContain("1,154 early listeners have no place on the map yet");
  });

  describe("how much is placed, and where the panel opens", () => {
    it("under the map, how much of the period is placed, in its own numbers, while under 90%", async () => {
      visitors = withPlaced([1, 1206], [189, 212]);
      act(() => root.render(<Listeners />));
      await flush();
      act(() => button("All time").click());
      expect(q("listeners-placed")?.textContent).toBe("1 of 1,206 placed so far. The map fills in as listeners come back.");
      act(() => button("This week").click());
      expect(q("listeners-placed")?.textContent).toBe("189 of 212 placed so far. The map fills in as listeners come back.");
    });

    it("goes away at 90% placed", async () => {
      visitors = withPlaced([1, 1206], [190, 211]);
      act(() => root.render(<Listeners />));
      await flush();
      act(() => button("This week").click());
      expect(q("listeners-placed")).toBeNull(); // 190 of 211 is 90.05%
      act(() => button("All time").click());
      expect(q("listeners-placed")).not.toBeNull(); // the control: the same render shows it under 90%
    });

    it("never on Right now, where everyone is placed", async () => {
      visitors = { ...withPlaced([1, 1206], [1, 212]), locations: { ...withPlaced([1, 1206], [1, 212]).locations, now: place([["US", "United States", 5]], [["Nevada", "NV", 5]]) } };
      act(() => root.render(<Listeners />));
      await flush();
      expect(pressed()).toEqual(["Right now"]);
      expect(q("listeners-map")).not.toBeNull();
      expect(q("listeners-placed")).toBeNull();
    });

    it("opens where the data is: All time, else This week, else Right now", async () => {
      for (const [data, want] of [
        [withPlaced([302, 1206], [10, 212]), "All time"],
        [withPlaced([1, 1206], [53, 212]), "This week"],
        [withPlaced([1, 1206], [52, 212]), "Right now"],
      ] as const) {
        visitors = data;
        act(() => root.render(<Listeners key={want} />));
        await flush();
        expect(pressed(), want).toEqual([want]);
      }
    });

    it("a period the listener picks stays picked when a poll brings new numbers", async () => {
      visitors = withPlaced([1, 1206], [1, 212]);
      act(() => root.render(<Listeners />));
      await flush();
      expect(pressed()).toEqual(["Right now"]);
      act(() => button("This week").click());
      expect(q("listeners-placed")?.textContent).toMatch(/^1 of 212 /);

      // New numbers in which All time would now be the default.
      visitors = withPlaced([600, 1206], [20, 212]);
      await poll();
      expect(q("listeners-placed")?.textContent).toMatch(/^20 of 212 /); // the poll landed
      expect(pressed()).toEqual(["This week"]);
    });
  });

  it("renders nothing when the stats service is unavailable", async () => {
    available = false;
    act(() => root.render(<Listeners />));
    // fetchWithRetry retries a 503 once after a backoff: wait it out.
    for (let i = 0; i < 60 && host.textContent !== ""; i++) await flush();
    expect(host.textContent).toBe("");
  });
});
