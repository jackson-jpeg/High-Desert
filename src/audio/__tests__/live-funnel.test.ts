import { describe, it, expect, vi } from "vitest";

/**
 * Tuning in is the funnel's third step (docs/funnel.md), and a line on the
 * phone lines ("A new listener tuned in"): the module-level
 * `tuneIn()` every surface calls reports it — but only when there is a
 * station to tune in to.
 */

vi.mock("@/audio/engine", () => ({
  engineState: () => null,
  onEngineEvent: () => () => {},
  pauseEngine: () => {},
  seekEngine: () => {},
}));
const funnel = vi.hoisted(() => ({ noteFunnelStep: vi.fn() }));
vi.mock("@/services/stats/funnel-client", () => funnel);
const lines = vi.hoisted(() => ({ announceTuneIn: vi.fn() }));
vi.mock("@/services/live/client", () => lines);

const { installLiveStation, tuneIn, tuneOut } = await import("../live-controller");

function deps() {
  return {
    fetchSchedule: vi.fn(async () => null),
    fetchServerNow: vi.fn(async () => Date.now()),
    startEpisode: vi.fn(),
    resolveEpisode: vi.fn(),
    stationId: { prepare: vi.fn(), start: vi.fn(), stop: vi.fn(), release: vi.fn() },
  };
}

describe("tune-in reaches the funnel and the phone lines", () => {
  it("a tune-in with a station installed is reported and announced; one with none is neither", () => {
    tuneIn();
    expect(funnel.noteFunnelStep).not.toHaveBeenCalled();
    expect(lines.announceTuneIn).not.toHaveBeenCalled();

    const d = deps();
    const uninstall = installLiveStation(d as never);
    tuneIn();
    expect(funnel.noteFunnelStep).toHaveBeenCalledWith("tune");
    expect(lines.announceTuneIn).toHaveBeenCalledTimes(1);
    // Announced after the station had its go at starting, never before.
    expect(d.stationId.prepare.mock.invocationCallOrder[0]).toBeLessThan(lines.announceTuneIn.mock.invocationCallOrder[0]);
    tuneOut();
    uninstall();
  });
});
