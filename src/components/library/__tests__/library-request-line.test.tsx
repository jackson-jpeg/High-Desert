import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { pacificDayBounds, requestCloseAt, type LiveSchedule, type ProgramSlot } from "@/lib/live/schedule";

/**
 * The desktop Library's Request Line line (2026-11-18): tonight's request in
 * Live's own words, a link to the Request Line, for every desktop visitor;
 * nothing before the program arrives and nothing once the request has aired.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { LibraryRequestLine } = await import("@/components/library/LibraryRequestLine");
const { useLiveStore } = await import("@/stores/live-store");
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

function stationAt(at: number, guide: ProgramSlot[] | null) {
  const schedule: LiveSchedule | null = guide && {
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

function picks(n: number) {
  const nominations = Array.from({ length: n }, (_, i) => ({ id: i + 1, fileHash: `archive:coll:pick-${i}.mp3`, title: `Pick ${i}`, votes: i }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url) === "/live-api/requests"
        ? new Response(JSON.stringify({ day: DAY, closesAt: requestCloseAt(DAY), startsAt: TEN_PM, nominations, nominated: false, tonight: null, admin: false }), { status: 200 })
        : new Response("{}", { status: 404 }),
    ),
  );
}

let root: Root;
let host: HTMLDivElement;
async function mount(look: "night" | "win98" = "night") {
  act(() => root.render(<LookProvider look={look}><LibraryRequestLine /></LookProvider>));
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
}
const line = () => host.querySelector<HTMLAnchorElement>('[data-testid="library-request-note"]');

beforeEach(() => {
  useLiveStore.setState({ schedule: null, clockOffsetMs: null });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the desktop Library's Request Line line", () => {
  for (const look of ["night", "win98"] as const) {
    it(`${look}: before 6 PM, tonight's request and how many are in the running, one link`, async () => {
      picks(3);
      stationAt(EARLY.start + H, [EARLY, ON_THE_HOUR]);
      await mount(look);
      expect(line()?.tagName).toBe("A");
      expect(line()?.getAttribute("href")).toBe("/request-line");
      expect(line()?.textContent).toContain("Tonight's request at 10 PM Pacific. 3 shows in the running, vote by 6 PM.");
      expect(host.textContent).not.toContain(DASH);
    });
  }

  it("nothing before the program arrives", async () => {
    stationAt(EARLY.start + H, null);
    await mount();
    expect(host.innerHTML).toBe("");
  });

  it("nothing once tonight's request has aired (control: the same day before it shows the line)", async () => {
    stationAt(ON_THE_HOUR.end + 1_000, [EARLY, ON_THE_HOUR]);
    await mount();
    expect(line()).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    stationAt(EARLY.start + H, [EARLY, ON_THE_HOUR]);
    await mount();
    expect(line()).not.toBeNull();
  });
});
