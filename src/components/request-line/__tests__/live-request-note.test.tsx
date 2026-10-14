import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SilentEventSource } from "@/test-support/event-source";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { pacificDayBounds, requestCloseAt, type LiveSchedule, type ProgramSlot } from "@/lib/live/schedule";
import { tonightsRequest, tonightsRequestText } from "@/lib/live/request-line";

/**
 * "Tonight's request at 10 PM" on Live (2026-10-14, docs/request-line.md):
 * under the phone's strip and in the desktop console, both looks. It reads
 * the published program: open for votes until 6 PM Pacific; then the pick and
 * who asked for it; on a night nobody nominated, a fan favorite; nothing once
 * the request has aired.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const mobile = vi.hoisted(() => ({ value: true }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/live",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => mobile.value, useMediaQuery: () => mobile.value }));
vi.mock("@/audio/live-controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/audio/live-controller")>()),
  tuneIn: vi.fn(),
  leaveStation: vi.fn(),
}));

const { LiveStation } = await import("@/components/live/LiveStation");
const { useLiveStore } = await import("@/stores/live-store");
const { resetNowFeedForTests } = await import("@/services/stats/now-feed");
const { LookProvider } = await import("@/hooks/useLook");

const H = 3_600_000;
const DAY = "2026-10-14";
const { start: DAY_START, end: DAY_END } = pacificDayBounds(DAY);
const TEN_PM = DAY_END - 2 * H;
const DASH = "—";

function slot(n: number, start: number, lengthMs: number, extra: Partial<ProgramSlot> = {}): ProgramSlot {
  return {
    fileHash: `archive:coll:show-${n}.mp3`,
    episodeId: `coll--show-${n}`,
    title: `Coast to Coast AM - Episode ${n}`,
    airDate: `199${n}-10-14`,
    guestName: `Guest ${n}`,
    showType: "coast",
    duration: lengthMs / 1000,
    sourceUrl: null,
    kind: "on-this-date",
    start,
    end: start + lengthMs,
    ...extra,
  };
}

const EARLY = slot(1, DAY_START, 3 * H);
const ON_THE_HOUR = slot(2, TEN_PM, 2 * H, { kind: "fan-favorite", requestSlot: true });
const WINNER = slot(3, TEN_PM, 2 * H, {
  kind: "request",
  title: "Coast to Coast AM - Area 51",
  request: { by: "Night Owl", place: "Pahrump", votes: 7, day: DAY },
});

function stationAt(at: number, guide: ProgramSlot[]) {
  const schedule: LiveSchedule = {
    day: DAY,
    tz: "America/Los_Angeles",
    serverNow: at,
    stationIdSec: 8,
    now: { stationId: true, endsAt: at },
    upNext: [],
    rest: [],
    guide,
    outage: false,
  };
  useLiveStore.setState({ clockOffsetMs: at - Date.now(), clockRttMs: 20, schedule });
}

let root: Root;
let host: HTMLDivElement;
async function mount(look: "night" | "win98") {
  act(() => root.render(<LookProvider look={look}><LiveStation /></LookProvider>));
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
}
const note = () => host.querySelector<HTMLAnchorElement>('[data-testid="live-request-note"]');

beforeEach(() => {
  resetNowFeedForTests();
  useLiveStore.setState({ tuned: false, paused: false, phase: "off", current: null, schedule: null, clockOffsetMs: null });
  vi.stubGlobal("EventSource", SilentEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).startsWith("/api/stats/now")
        ? new Response(JSON.stringify({ online: 8, listening: 3, live: 5, onAir: [], recent: [] }), { status: 200 })
        : new Response("{}", { status: 404 }),
    ),
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

describe("tonightsRequest: what the 10 PM slot is, from the program", () => {
  it("voting until 6 PM, then the pick, or a fan favorite, then nothing once it has aired", () => {
    expect(tonightsRequest([EARLY, ON_THE_HOUR], DAY, DAY_START + H).state).toBe("voting");
    expect(tonightsRequest([EARLY, ON_THE_HOUR], DAY, requestCloseAt(DAY) - 1).state).toBe("voting");
    expect(tonightsRequest([EARLY, ON_THE_HOUR], DAY, requestCloseAt(DAY)).state).toBe("favorite");
    expect(tonightsRequest([EARLY, WINNER], DAY, requestCloseAt(DAY) + 1)).toMatchObject({ state: "locked", startsAt: TEN_PM });
    expect(tonightsRequest([EARLY, WINNER], DAY, WINNER.end).state).toBe("over");
  });

  it("says it in plain words, never an em dash", () => {
    const texts = [
      tonightsRequestText(tonightsRequest([ON_THE_HOUR], DAY, DAY_START)),
      tonightsRequestText(tonightsRequest([WINNER], DAY, requestCloseAt(DAY) + 1)),
      tonightsRequestText(tonightsRequest([ON_THE_HOUR], DAY, requestCloseAt(DAY) + 1)),
    ];
    expect(texts).toEqual([
      "Tonight's request at 10 PM. Pick a show or vote by 6 PM Pacific.",
      "Tonight's request at 10 PM: Coast to Coast AM - Area 51, from Night Owl, calling from Pahrump.",
      "No request tonight. A fan favorite plays at 10 PM.",
    ]);
    for (const t of texts) expect(t).not.toContain(DASH);
    expect(tonightsRequestText({ state: "over" })).toBeNull();
  });
});

for (const look of ["night", "win98"] as const) {
  for (const phone of [true, false]) {
    describe(`the Live note (${look}, ${phone ? "phone" : "desktop"})`, () => {
      beforeEach(() => {
        mobile.value = phone;
      });

      it("before 6 PM: Tonight's request at 10 PM, one link to the Request Line", async () => {
        stationAt(EARLY.start + H, [EARLY, ON_THE_HOUR]);
        await mount(look);
        expect(note()?.getAttribute("href")).toBe("/request-line");
        expect(note()?.dataset.state).toBe("voting");
        expect(note()?.textContent).toContain("Tonight's request at 10 PM");
        expect(host.textContent).not.toContain(DASH);
      });

      it("locked: the pick and who asked for it, also in Tonight's log", async () => {
        stationAt(requestCloseAt(DAY) + H, [EARLY, WINNER]);
        await mount(look);
        expect(note()?.dataset.state).toBe("locked");
        expect(note()?.textContent).toContain("Area 51, from Night Owl, calling from Pahrump");
        const log = host.querySelector('[data-testid="live-guide"]')!;
        expect(log.textContent).toContain("Requested by Night Owl, calling from Pahrump");
        expect(host.textContent).not.toContain(DASH);
      });

      it("the empty night says a fan favorite; once aired the note is gone", async () => {
        stationAt(requestCloseAt(DAY) + H, [EARLY, ON_THE_HOUR]);
        await mount(look);
        expect(note()?.dataset.state).toBe("favorite");
        act(() => root.unmount());
        root = createRoot(host);
        stationAt(WINNER.end + 1_000, [EARLY, WINNER]);
        await mount(look);
        expect(note()).toBeNull();
      });
    });
  }
}
