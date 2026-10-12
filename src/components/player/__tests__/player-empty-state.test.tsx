import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LiveSchedule, ProgramSlot } from "@/lib/live/schedule";

/**
 * The player with nothing loaded used to draw nothing. It now shows what is on
 * the station and one tap to tune in, in both looks, read from the shared live
 * store (the program the controller fetches), and the tap is `tuneIn()`
 * itself, so audio starts inside the gesture. Never on the Live screen, whose
 * own Listen card is the phone's one tune-in control.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const live = vi.hoisted(() => ({ tuneIn: vi.fn(), warmLiveStation: vi.fn(async () => {}) }));
vi.mock("@/audio/live-controller", async () => {
  const actual = await vi.importActual<typeof import("@/audio/live-controller")>("@/audio/live-controller");
  return { ...actual, tuneIn: live.tuneIn, warmLiveStation: live.warmLiveStation };
});
const nav = vi.hoisted(() => ({ pathname: "/library" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/hooks/useAudioPlayer", () => ({
  useAudioPlayer: () => ({ togglePlay: vi.fn(), seek: vi.fn(), stopPlayback: vi.fn(), playNext: vi.fn(), playPrevious: vi.fn() }),
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => false, useMediaQuery: () => false }));

const { PlayerEmptyState } = await import("../PlayerEmptyState");
const { AudioPlayer } = await import("../AudioPlayer");
const { usePlayerStore } = await import("@/stores/player-store");
const { LookProvider } = await import("@/hooks/useLook");
const { useLiveStore } = await import("@/stores/live-store");

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
  return { day: "2026-10-12", tz: "America/Los_Angeles", serverNow: Date.now(), stationIdSec: 8, now: null, upNext: [], rest: [], guide: slots, outage: false } as unknown as LiveSchedule;
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  live.tuneIn.mockClear();
  nav.pathname = "/library";
  useLiveStore.setState({ schedule: null, clockOffsetMs: 0 });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(look: "win98" | "night") {
  act(() => root.render(createElement(LookProvider, { look }, createElement(PlayerEmptyState))));
}
const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe("the empty player", () => {
  for (const look of ["win98", "night"] as const) {
    it(`${look}: shows the show on the air and tunes in on one tap`, () => {
      useLiveStore.getState().setSchedule(schedule([slot()]));
      render(look);
      expect(q("player-empty")?.dataset.lookVariant).toBe(look);
      expect(q("player-empty-title")?.textContent).toBe("Coast to Coast AM - Area 51 with Bob Lazar");
      expect(live.tuneIn).not.toHaveBeenCalled();
      act(() => q("player-empty-tune")!.click());
      expect(live.tuneIn).toHaveBeenCalledTimes(1);
    });
  }

  it("between shows it still offers the station", () => {
    useLiveStore.getState().setSchedule(schedule([slot({ start: Date.now() - 7_200_000, end: Date.now() - 4_000 })]));
    render("win98");
    expect(q("player-empty-title")?.textContent).toMatch(/^Between shows/);
    expect(q("player-empty-tune")).not.toBeNull();
  });

  it("with no program yet it says so and offers no tap that could not start", () => {
    render("night");
    expect(q("player-empty-title")?.textContent).toMatch(/^Nothing playing/);
    expect(q("player-empty-tune")).toBeNull();
  });

  it("is not drawn on the Live screen", () => {
    nav.pathname = "/live";
    useLiveStore.getState().setSchedule(schedule([slot()]));
    render("win98");
    expect(q("player-empty")).toBeNull();
  });

  it("uses no em dash", () => {
    useLiveStore.getState().setSchedule(schedule([slot()]));
    render("night");
    expect(host.textContent).not.toContain("—");
  });

  it("is what the player draws, in either look, when nothing is loaded", () => {
    usePlayerStore.setState({ currentEpisode: null });
    useLiveStore.getState().setSchedule(schedule([slot()]));
    for (const look of ["win98", "night"] as const) {
      act(() => root.render(createElement(LookProvider, { look }, createElement(AudioPlayer))));
      expect(q("player-empty")?.dataset.lookVariant).toBe(look);
    }
  });
});
