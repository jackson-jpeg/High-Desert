import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The real SignalTraffic panel, mounted with the network stubbed: a render
 * smoke test for the HD-018 split (panel, chart, hour profile, summary, and
 * the useTraffic fetch). `fetch` answers /api/stats/traffic in the route's
 * documented shape; nothing of the component is mocked.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { SignalTraffic } = await import("@/components/library/SignalTraffic");

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 20, 12);

function traffic(range: string) {
  return {
    range,
    points: Array.from({ length: 12 }, (_, i) => ({
      t: new Date(T0 + i * HOUR).toISOString(),
      online: i === 5 ? 7 : 2,
      listening: 1,
      plays: i === 5 ? 3 : 0,
    })),
    peakOnline: 7,
    peakListening: 3,
    playsInRange: 3,
    totalPlays: 1234,
    peakAt: new Date(T0 + 5 * HOUR).toISOString(),
    // Every UTC hour sampled, so the profile clears its 8-hour floor.
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour, online: hour === 3 ? 5 : 1, listening: 0, plays: 0, samples: 4,
    })),
  };
}

let root: Root;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    const m = /\/api\/stats\/traffic\?range=(\w+)/.exec(String(url));
    if (m) return new Response(JSON.stringify(traffic(m[1])), { status: 200 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const text = () => host.textContent ?? "";
const requested = () => fetchMock.mock.calls.map((c) => String(c[0]));

describe("SignalTraffic", () => {
  it("renders the summary, chart, legend, tiles and hour profile from sample data", async () => {
    act(() => root.render(createElement(SignalTraffic)));
    expect(text()).toContain("Reading the logs");
    await flush();

    expect(requested()).toContain("/api/stats/traffic?range=24h");
    // Summary sentence
    expect(text()).toContain("people were here at once");
    expect(text()).toContain("shows played in the last 24 hours");
    // Chart: the keyboard-readable figure, its SVG and the peak readout
    const chart = host.querySelector('[role="img"]');
    expect(chart?.getAttribute("aria-label")).toContain("Peak 7 concurrent visitors");
    expect(chart?.querySelector("svg path")).not.toBeNull();
    // Legend and tiles
    expect(text()).toContain("Listening");
    expect(text()).toContain("Peak online");
    expect(text()).toContain("1,234");
    // Plays all time predates the event log every range total is drawn from;
    // the page says so rather than leaving the mismatch to look like a bug.
    expect(text()).toContain("before per-play timestamps began on 28 Jul 2026");
    // Hour profile (24 columns)
    expect(text()).toContain("When the desert is awake");
    expect(host.querySelectorAll('[title*="people on average"]')).toHaveLength(24);
  });

  it("draws each bucket's busiest moment as the main line, and its mean dashed", async () => {
    // A bucket whose mean is 2 but whose busiest sample was 9: the scale and
    // the main line follow the 9, the dashed line the 2.
    fetchMock.mockImplementation(async (url: string) => {
      const m = /\/api\/stats\/traffic\?range=(\w+)/.exec(String(url));
      if (!m) return new Response("{}", { status: 404 });
      const t = traffic(m[1]);
      t.points = t.points.map((p, i) => ({ ...p, online: 2, onlineMax: i === 5 ? 9 : 2, listeningMax: 1 }));
      return new Response(JSON.stringify(t), { status: 200 });
    });
    act(() => root.render(createElement(SignalTraffic)));
    await flush();
    expect(host.querySelector('[data-testid="traffic-scale-top"]')?.textContent).toBe("9");
    const chart = host.querySelector('[role="img"]')!;
    expect(chart.getAttribute("aria-label")).toContain("Peak 9 concurrent visitors");
    // Scale-top label is outside the plot, so it can never cover a point.
    expect(chart.contains(host.querySelector('[data-testid="traffic-scale-top"]'))).toBe(false);
    const d = (s: string) => chart.querySelector(`path[data-series="${s}"]`)?.getAttribute("d") ?? "";
    const yAt = (path: string, i: number) => Number(path.split(" ")[i].slice(1).split(",")[1]);
    // The max line reaches the top of the plot at the burst; the mean stays low.
    expect(yAt(d("online-max"), 5)).toBeLessThan(yAt(d("online-avg"), 5));
    expect(d("online-avg")).not.toBe("");
    expect(chart.querySelector('path[data-series="online-avg"]')?.getAttribute("stroke-dasharray")).toBe("3 3");
  });

  it("refetches when the range changes", async () => {
    act(() => root.render(createElement(SignalTraffic)));
    await flush();
    const seven = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("7 days"))!;
    act(() => seven.click());
    await flush();
    expect(requested()).toContain("/api/stats/traffic?range=7d");
    expect(seven.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders nothing when the stats service is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    act(() => root.render(createElement(SignalTraffic)));
    // A 503 is retried once after a second before fetchTraffic gives up.
    await act(async () => { await new Promise((r) => setTimeout(r, 1500)); });
    await flush();
    expect(host.innerHTML).toBe("");
  });
});
