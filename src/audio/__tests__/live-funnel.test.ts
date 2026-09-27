import { describe, it, expect, vi } from "vitest";

/**
 * Tuning in is the funnel's third step (docs/funnel.md): the module-level
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

describe("tune-in reaches the funnel", () => {
  it("a tune-in with a station installed is reported; one with none is not", () => {
    tuneIn();
    expect(funnel.noteFunnelStep).not.toHaveBeenCalled();

    const uninstall = installLiveStation(deps() as never);
    tuneIn();
    expect(funnel.noteFunnelStep).toHaveBeenCalledWith("tune");
    tuneOut();
    uninstall();
  });
});
