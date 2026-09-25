import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SilentEventSource } from "@/test-support/event-source";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Every presence surface shows the same numbers.
 *
 * One screen once read 7 online on the Stats tab badge, 8 in the status bar
 * and 10 in On Air. Three causes: the badge showed online − 1, the shell and
 * On Air polled two different endpoints on two clocks, and "online" counted
 * page loads rather than people. The server half is `presence-clients.db.test`;
 * this is the client half.
 *
 * The real shell, On Air and Signal Traffic are mounted together, with the
 * mobile sheet opened, against one fixture. The fixture is built to catch a
 * surface that forks onto its own count: /api/stats/now says 8 and 3, the
 * legacy /api/stats/active says something else, and the newest traffic sample
 * says something else again. A surface reading either of those, or doing its
 * own arithmetic, shows a number that is not 8.
 *
 * Assertions are on the **visible text** of each surface, not only on its
 * data attributes: the attributes are what the live check reads, but the text
 * is what a listener reads, and a fork could keep one honest and not the other.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // Not /stats: the badge hides on the page it points at.
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => undefined }));
vi.mock("@/db", () => ({
  db: {},
  getPreference: () => new Promise(() => {}),
  setPreference: async () => {},
}));
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useMediaQuery: () => false,
}));
vi.mock("@/components/desktop/Starfield", () => ({ Starfield: () => null }));

const { DesktopShell } = await import("@/components/desktop/DesktopShell");
const { OnAir } = await import("@/components/library/OnAir");
const { SignalTraffic } = await import("@/components/library/SignalTraffic");
const { resetNowFeedForTests } = await import("@/services/stats/now-feed");
const { LiveStation } = await import("@/components/live/LiveStation");
const { useLiveStore } = await import("@/stores/live-store");

const NOW = { online: 8, listening: 3, live: 2, onAir: [{ episodeId: "coll--show", listeners: 3 }], recent: [] };
const LEGACY_ACTIVE = { count: 2, online: 7, listening: 2 };
const LATEST_SAMPLE = { online: 10, listening: 5 };

function traffic() {
  const t0 = Date.now() - 12 * 3_600_000;
  return {
    range: "24h",
    points: Array.from({ length: 12 }, (_, i) => ({
      t: new Date(t0 + i * 3_600_000).toISOString(),
      online: i === 11 ? LATEST_SAMPLE.online : 2,
      listening: i === 11 ? LATEST_SAMPLE.listening : 1,
      plays: 0,
    })),
    peakOnline: 10,
    peakListening: 5,
    playsInRange: 0,
    totalPlays: 100,
    peakAt: null,
    hourly: [],
  };
}

let root: Root;
let host: HTMLDivElement;

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

beforeEach(() => {
  resetNowFeedForTests();
  vi.stubGlobal("EventSource", SilentEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (u.startsWith("/api/stats/now")) return json(NOW);
      if (u.startsWith("/api/stats/active")) return json(LEGACY_ACTIVE);
      if (u.startsWith("/api/stats/traffic")) return json(traffic());
      if (u.startsWith("/api/stats/heartbeat")) return json({ ok: true });
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
  resetNowFeedForTests();
});

/** Integers in a surface's visible text, in reading order. */
function numbersIn(el: Element): number[] {
  return (el.textContent ?? "").match(/\d+/g)?.map(Number) ?? [];
}

describe("presence: one truth on every surface", () => {
  it("the badge, status bar, mobile sheet, On Air and Signal Traffic all show the /now numbers", async () => {
    act(() => {
      root.render(
        <DesktopShell episodeCount={1312}>
          <OnAir />
          <SignalTraffic />
        </DesktopShell>,
      );
    });
    await flush();

    // Open the mobile sheet — its presence row only renders while open.
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="More options"]');
    expect(more).not.toBeNull();
    act(() => more!.click());
    await flush();

    const surfaces = [...host.querySelectorAll("[data-presence]")];
    const names = surfaces.map((s) => s.getAttribute("data-presence")).sort();
    expect(names).toEqual(["badge", "mobile-sheet", "on-air", "signal-traffic", "status-bar"]);

    const polls = new Set(surfaces.map((s) => s.getAttribute("data-presence-poll")));
    expect(polls.size).toBe(1);

    for (const s of surfaces) {
      const name = s.getAttribute("data-presence");
      expect(s.getAttribute("data-online"), name!).toBe("8");
      expect(s.getAttribute("data-listening"), name!).toBe("3");
      const shown = numbersIn(s);
      // The badge shows online only; every other surface shows both.
      expect(shown, name!).toEqual(name === "badge" ? [8] : [8, 3]);
    }
  });

  it("the Live screen's count is the same snapshot, on the same poll, with its own live figure", async () => {
    const at = Date.now();
    const slot = {
      fileHash: "archive:coll:show.mp3", episodeId: "coll--show", title: "Show", airDate: "1997-07-28",
      guestName: null, showType: "coast", duration: 3600, sourceUrl: null, kind: "on-this-date" as const,
      start: at - 60_000, end: at + 3_540_000,
    };
    useLiveStore.setState({
      schedule: {
        day: "2026-09-25", tz: "America/Los_Angeles", serverNow: at, stationIdSec: 8,
        now: { slot, startedAt: slot.start, offsetSec: 60, endsAt: slot.end },
        upNext: [], rest: [], guide: [slot], outage: false,
      },
    });
    try {
      act(() => {
        root.render(
          <DesktopShell episodeCount={1312}>
            <LiveStation />
          </DesktopShell>,
        );
      });
      await flush();
      const live = host.querySelector('[data-presence="live"]');
      const bar = host.querySelector('[data-presence="status-bar"]');
      expect(live).not.toBeNull();
      expect(live!.getAttribute("data-presence-poll")).toBe(bar!.getAttribute("data-presence-poll"));
      expect(live!.getAttribute("data-online")).toBe("8");
      expect(live!.getAttribute("data-listening")).toBe("3");
      expect(live!.getAttribute("data-live")).toBe("2");
      // What a listener reads: 2 tuned in live, 8 online.
      expect(numbersIn(live!)).toEqual([2, 8]);
    } finally {
      useLiveStore.setState({ schedule: null });
    }
  });

  it("the badge stays hidden when the only person here is you", async () => {
    NOW.online = 1;
    try {
      act(() => {
        root.render(<DesktopShell episodeCount={1312}>{null}</DesktopShell>);
      });
      await flush();
      expect(host.querySelector('[data-presence="status-bar"]')?.getAttribute("data-online")).toBe("1");
      expect(host.querySelector('[data-presence="badge"]')).toBeNull();
    } finally {
      NOW.online = 8;
    }
  });
});
