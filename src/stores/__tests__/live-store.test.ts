import { describe, it, expect, beforeEach } from "vitest";
import { serverNow, useLiveStore } from "../live-store";
import type { LiveSchedule, ProgramSlot } from "@/lib/live/schedule";

function schedule(serverNowMs: number, title: string): LiveSchedule {
  return {
    day: "2026-09-25",
    tz: "America/Los_Angeles",
    serverNow: serverNowMs,
    stationIdSec: 8,
    now: { stationId: true, endsAt: serverNowMs + 1000 },
    upNext: [],
    rest: [],
    guide: [{ title } as ProgramSlot],
    outage: false,
  };
}

const SLOT = { fileHash: "archive:c:x.mp3", start: 1, end: 2 } as ProgramSlot;

beforeEach(() => {
  useLiveStore.setState({
    tuned: false,
    phase: "off",
    current: null,
    clockOffsetMs: null,
    clockRttMs: null,
    schedule: null,
    drift: null,
  });
});

describe("useLiveStore", () => {
  it("serverNow is the local clock until a sync, then local plus the offset", () => {
    expect(serverNow(1_000)).toBe(1_000);
    useLiveStore.getState().setClock(-37_000, 40);
    expect(serverNow(1_000)).toBe(-36_000);
    expect(useLiveStore.getState().clockRttMs).toBe(40);
  });

  it("an older schedule arriving late does not replace a newer one", () => {
    const { setSchedule } = useLiveStore.getState();
    setSchedule(schedule(2_000, "newer"));
    setSchedule(schedule(1_000, "older"));
    expect(useLiveStore.getState().schedule!.guide[0].title).toBe("newer");
    setSchedule(schedule(3_000, "newest"));
    expect(useLiveStore.getState().schedule!.guide[0].title).toBe("newest");
  });

  it("a phase is only set while tuned in", () => {
    useLiveStore.getState().setPhase("show", SLOT);
    expect(useLiveStore.getState().phase).toBe("off");
    useLiveStore.getState().setTuned(true);
    useLiveStore.getState().setPhase("show", SLOT);
    expect(useLiveStore.getState()).toMatchObject({ phase: "show", current: SLOT });
  });

  it("tuning out clears the phase, the slot and the drift, and keeps the clock and program", () => {
    const s = useLiveStore.getState();
    s.setClock(500, 20);
    s.setSchedule(schedule(1, "p"));
    s.setTuned(true);
    s.setPhase("show", SLOT);
    s.setDrift(1.5);
    useLiveStore.getState().setTuned(false);
    expect(useLiveStore.getState()).toMatchObject({
      tuned: false,
      phase: "off",
      current: null,
      drift: null,
      clockOffsetMs: 500,
    });
    expect(useLiveStore.getState().schedule).not.toBeNull();
  });
});
