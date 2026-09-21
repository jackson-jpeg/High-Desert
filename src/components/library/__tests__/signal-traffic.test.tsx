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
    // Hour profile (24 columns)
    expect(text()).toContain("When the desert is awake");
    expect(host.querySelectorAll('[title*="people on average"]')).toHaveLength(24);
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
