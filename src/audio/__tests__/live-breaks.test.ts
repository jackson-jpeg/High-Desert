import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { LiveSchedule, ProgramSlot } from "@/lib/live/schedule";
import type { StationBreak } from "@/lib/live/breaks";
import type { Episode } from "@/db/schema";

/**
 * Station breaks on the air (docs/station-breaks.md): the controller plays a
 * break's spot in the gap it sits in, before the station ID; never for a
 * listener who muted breaks, never from halfway; and drops it for the ID when
 * breaks are muted mid-spot.
 */

const { useLiveStore } = await import("@/stores/live-store");
const { createLiveStation } = await import("../live-controller");

const T0 = Date.UTC(2026, 10, 16, 3, 0, 0);
const GAP = 8_000;

function slot(name: string, start: number, ms: number): ProgramSlot {
  return {
    fileHash: `archive:c:${name}.mp3`,
    episodeId: `c--${name}`,
    title: name,
    airDate: null,
    guestName: null,
    showType: "coast",
    duration: ms / 1000,
    sourceUrl: `https://archive.org/download/c/${name}.mp3`,
    kind: "fan-favorite",
    start,
    end: start + ms,
  };
}

let A: ProgramSlot;
let B: ProgramSlot;
let brk: StationBreak;
let muted = false;
const starts: (string | undefined)[] = [];
const aired: string[] = [];
const stationId = {
  start: vi.fn(async (spot?: string) => {
    starts.push(spot);
  }),
  stop: vi.fn(),
  release: vi.fn(),
};

function schedule(breakStartOffset = 0): LiveSchedule {
  brk = {
    id: "2026-11-15:evening",
    day: "2026-11-15",
    slot: "evening",
    spot: "sogojet",
    cart: "07",
    url: "/audio/breaks/sogojet.mp3",
    durationSec: 18,
    card: true,
    start: A.end + breakStartOffset,
    end: A.end + breakStartOffset + 18_000,
  };
  B = slot("b", brk.start + 19_000 + GAP, 3_600_000);
  return {
    day: "2026-11-15",
    tz: "America/Los_Angeles",
    serverNow: Date.now(),
    stationIdSec: 8,
    now: { slot: A, startedAt: A.start, offsetSec: 0, endsAt: A.end },
    upNext: [B],
    rest: [],
    guide: [A, B],
    outage: false,
    breaks: [brk],
  };
}

let station: ReturnType<typeof createLiveStation>;
let uninstall: () => void;

function setup(breakStartOffset = 0) {
  A = slot("a", T0 - 60_000, 70_000); // ends 10 s from now
  const s = schedule(breakStartOffset);
  useLiveStore.getState().setSchedule(s);
  station = createLiveStation({
    fetchSchedule: async () => s,
    fetchServerNow: async () => Date.now(),
    startEpisode: () => {},
    resolveEpisode: (x) => ({ id: 1, fileHash: x.fileHash, title: x.title }) as Episode,
    stationId,
    breaksMuted: () => muted,
    onBreakAired: (b) => aired.push(b.id),
  });
  uninstall = station.install();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
  muted = false;
  starts.length = 0;
  aired.length = 0;
  for (const fn of Object.values(stationId)) fn.mockClear();
  sessionStorage.clear();
  useLiveStore.setState({ tuned: false, paused: false, phase: "off", current: null, clockOffsetMs: 0, clockRttMs: 10, schedule: null, drift: null });
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

describe("a station break on the air", () => {
  it("plays the spot when the show before it ends, then counts it heard", async () => {
    setup();
    station.tuneIn();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(useLiveStore.getState().phase).toBe("station-id");
    expect(starts).toEqual([brk.url]);
    expect(aired).toEqual([brk.id]);
  });

  it("muted: the station ID only, nothing counted", async () => {
    muted = true;
    setup();
    station.tuneIn();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts).toEqual([undefined]);
    expect(aired).toEqual([]);
  });

  it("tuning in halfway through a break hears the station ID, never half an ad", async () => {
    setup();
    vi.setSystemTime(A.end + 8_000);
    station.tuneIn();
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([undefined]);
    expect(aired).toEqual([]);
  });

  it("tuning in at its first second hears it", async () => {
    setup();
    vi.setSystemTime(A.end + 1_000);
    station.tuneIn();
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([brk.url]);
  });

  it("a break later in the gap (the show before ran short): the ID now, the spot at its time", async () => {
    setup(20_000);
    station.tuneIn();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts).toEqual([undefined]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(starts).toEqual([undefined, brk.url]);
    expect(aired).toEqual([brk.id]);
  });

  it("muting mid-spot drops it for the station ID at once", async () => {
    setup();
    station.tuneIn();
    await vi.advanceTimersByTimeAsync(12_000);
    muted = true;
    station.skipBreak();
    expect(starts).toEqual([brk.url, undefined]);
  });

  it("without a break in the gap, the station ID as always", async () => {
    setup();
    useLiveStore.getState().setSchedule({ ...useLiveStore.getState().schedule!, breaks: [] });
    station.tuneIn();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts).toEqual([undefined]);
  });
});
