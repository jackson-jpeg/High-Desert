import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LiveSchedule, ProgramSlot } from "@/lib/live/schedule";

/**
 * The window above a new desktop visitor's Library (src/lib/live/station-welcome.ts):
 * the show on the air and one Listen live, which is `tuneIn()` inside the tap.
 * Closing it, or tuning in from anywhere, puts it away for good. A browser
 * that arrived with a library never sees it (the control for every "shows").
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const live = vi.hoisted(() => ({ tuneIn: vi.fn(), warmLiveStation: vi.fn(async () => {}) }));
vi.mock("@/audio/live-controller", async () => {
  const actual = await vi.importActual<typeof import("@/audio/live-controller")>("@/audio/live-controller");
  return { ...actual, tuneIn: live.tuneIn, warmLiveStation: live.warmLiveStation };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/library", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
const media = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => media.mobile, useMediaQuery: () => false }));

const { StationWelcome } = await import("../StationWelcome");
const { LookProvider } = await import("@/hooks/useLook");
const { useLiveStore } = await import("@/stores/live-store");
const { usePlayerStore } = await import("@/stores/player-store");
const { STATION_WELCOME_KEY } = await import("@/lib/live/station-welcome");
const { FUNNEL_STORAGE_KEY } = await import("@/services/stats/funnel-client");

function slot(over: Partial<ProgramSlot> = {}): ProgramSlot {
  const now = Date.now();
  return {
    fileHash: "archive:coll:a.mp3",
    episodeId: "coll--a",
    title: "Coast to Coast AM - Area 51",
    airDate: "1996-11-02",
    guestName: "Bob Lazar",
    showType: "coast",
    duration: 3 * 3600,
    sourceUrl: null,
    kind: "on-this-date",
    start: now - 600_000,
    end: now + 3_000_000,
    ...over,
  };
}

function schedule(slots: ProgramSlot[]): LiveSchedule {
  return { day: "2026-11-18", tz: "America/Los_Angeles", serverNow: Date.now(), stationIdSec: 8, now: null, upNext: [], rest: [], guide: slots, outage: false } as unknown as LiveSchedule;
}

const today = () => new Date().toISOString().slice(0, 10);

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  live.tuneIn.mockClear();
  media.mobile = false;
  useLiveStore.setState({ schedule: null, clockOffsetMs: 0, tuned: false });
  usePlayerStore.setState({ currentEpisode: null });
  useLiveStore.getState().setSchedule(schedule([slot()]));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function arrived(cohort: string | null) {
  localStorage.setItem(FUNNEL_STORAGE_KEY, JSON.stringify({ cohort, device: "desktop", done: ["visit"] }));
}
function render(look: "win98" | "night" = "win98") {
  act(() => root.render(createElement(LookProvider, { look }, createElement(StationWelcome))));
}
const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe("the station, first, on a new desktop visitor's Library", () => {
  for (const look of ["win98", "night"] as const) {
    it(`${look}: shows the show on the air and tunes in on one tap`, () => {
      arrived(today());
      render(look);
      expect(q("station-welcome")).not.toBeNull();
      expect(q("live-now-title")?.textContent).toBe("Area 51");
      expect(q("live-now-meta")?.textContent).toBe("with Bob Lazar · 1996");
      act(() => q("station-welcome-listen")!.click());
      expect(live.tuneIn).toHaveBeenCalledTimes(1);
    });
  }

  it("not for a browser that arrived with a library", () => {
    arrived(null);
    render();
    expect(q("station-welcome")).toBeNull();
  });

  it("not on a phone", () => {
    media.mobile = true;
    arrived(today());
    render();
    expect(q("station-welcome")).toBeNull();
  });

  it("closed, it stays closed", () => {
    arrived(today());
    render();
    act(() => q("station-welcome-close")!.click());
    expect(q("station-welcome")).toBeNull();
    expect(localStorage.getItem(STATION_WELCOME_KEY)).toBe("closed");
    act(() => root.unmount());
    root = createRoot(host);
    render();
    expect(q("station-welcome")).toBeNull();
  });

  it("tuned in from anywhere, it goes away for good", () => {
    arrived(today());
    render();
    expect(q("station-welcome")).not.toBeNull();
    act(() => useLiveStore.setState({ tuned: true }));
    expect(q("station-welcome")).toBeNull();
    expect(localStorage.getItem(STATION_WELCOME_KEY)).toBe("tuned");
  });

  it("uses no em dash", () => {
    arrived(today());
    render("night");
    expect(host.textContent).not.toContain("—");
  });
});
