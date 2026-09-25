import { describe, it, expect, vi } from "vitest";

/**
 * A surface that wants the program can mount before the station is installed:
 * React runs a child's effects before its parent's, so on a direct load of
 * /live the Live screen's warm-up runs before the layout installs the station.
 * That request must be kept and honoured at install — dropped, the screen sat
 * on "Warming up the transmitter…" until the next minute's poll.
 */

vi.mock("@/audio/engine", () => ({
  engineState: () => null,
  onEngineEvent: () => () => {},
  pauseEngine: () => {},
  seekEngine: () => {},
}));

const { installLiveStation, warmLiveStation } = await import("../live-controller");
const { useLiveStore } = await import("@/stores/live-store");

function deps() {
  return {
    fetchSchedule: vi.fn(async () => null),
    fetchServerNow: vi.fn(async () => Date.now()),
    startEpisode: vi.fn(),
    resolveEpisode: vi.fn(),
    stationId: { prepare: vi.fn(), start: vi.fn(), stop: vi.fn(), release: vi.fn() },
  };
}

describe("warming the station before it is installed", () => {
  it("a warm-up asked for before install is carried out at install", async () => {
    useLiveStore.setState({ schedule: null, clockOffsetMs: null });
    await warmLiveStation(); // the child's effect: no station yet
    const d = deps();
    const uninstall = installLiveStation(d as never); // the layout's effect
    await vi.waitFor(() => expect(d.fetchSchedule).toHaveBeenCalledTimes(1));
    expect(d.fetchServerNow).toHaveBeenCalled();
    uninstall();
  });

  it("control: with no warm-up pending, installing reads nothing", async () => {
    useLiveStore.setState({ schedule: null, clockOffsetMs: null });
    const d = deps();
    const uninstall = installLiveStation(d as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(d.fetchSchedule).not.toHaveBeenCalled();
    uninstall();
  });
});
