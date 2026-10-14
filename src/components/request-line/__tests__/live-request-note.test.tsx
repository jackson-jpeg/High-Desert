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
const note = () => host.querySelector<HTMLElement>('[data-testid="live-request-note"]');
/** Where the note goes: the whole note on a desktop, its Pick a show button on a phone. */
const noteHref = (phone: boolean) =>
  (phone ? host.querySelector('[data-testid="live-request-pick"]') : note())?.getAttribute("href") ?? null;

/** The Request Line's GET, answering `n` picks for `day`. */
function requestLineAnswers(n: number, day = DAY) {
  const nominations = Array.from({ length: n }, (_, i) => ({ id: i + 1, fileHash: `archive:coll:pick-${i}.mp3`, title: `Pick ${i}`, votes: i }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.startsWith("/api/stats/now")) return new Response(JSON.stringify({ online: 8, listening: 3, live: 5, onAir: [], recent: [] }), { status: 200 });
      if (u === "/live-api/requests") return new Response(JSON.stringify({ day, closesAt: requestCloseAt(day), startsAt: TEN_PM, nominations, nominated: false, tonight: null, admin: false }), { status: 200 });
      return new Response("{}", { status: 404 });
    }),
  );
}

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
        expect(noteHref(phone)).toBe("/request-line");
        expect(note()?.dataset.state).toBe("voting");
        expect(note()?.textContent).toContain("Tonight's request at 10 PM");
        expect(host.textContent).not.toContain(DASH);
      });

      it("once there are picks, says how many are in the running", async () => {
        requestLineAnswers(3);
        stationAt(EARLY.start + H, [EARLY, ON_THE_HOUR]);
        await mount(look);
        expect(note()?.dataset.picks).toBe("3");
        expect(note()?.textContent).toContain("3 shows in the running, vote by 6 PM Pacific.");
        expect(host.textContent).not.toContain(DASH);
      });

      it("one pick is one show; picks for another day are not tonight's", async () => {
        requestLineAnswers(1);
        stationAt(EARLY.start + H, [EARLY, ON_THE_HOUR]);
        await mount(look);
        expect(note()?.textContent).toContain("1 show in the running");
        act(() => root.unmount());
        root = createRoot(host);
        requestLineAnswers(4, "2026-10-15");
        stationAt(EARLY.start + H, [EARLY, ON_THE_HOUR]);
        await mount(look);
        expect(note()?.textContent).toContain("Pick a show or vote by 6 PM Pacific.");
        expect(note()?.textContent).not.toContain("in the running");
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

describe("on a phone, the note sits right under Listen live (2026-10-14)", () => {
  beforeEach(() => {
    mobile.value = true;
  });
  for (const look of ["night", "win98"] as const) {
    it(`${look}: hero, then the note with its Pick a show button, then Call in, the calls and the strip`, async () => {
      stationAt(EARLY.start + H, [EARLY, ON_THE_HOUR]);
      await mount(look);
      const order = Array.from(host.querySelectorAll<HTMLElement>("[data-testid]"))
        .map((el) => el.dataset.testid)
        .filter((id) => ["live-hero", "live-request-note", "live-call-in", "live-strip"].includes(id!));
      expect(order).toEqual(["live-hero", "live-request-note", "live-call-in", "live-strip"]);
      const pick = host.querySelector<HTMLAnchorElement>('[data-testid="live-request-pick"]');
      expect(pick?.textContent).toBe("Pick a show");
      expect(pick?.getAttribute("href")).toBe("/request-line");
      // One note on the screen: it left the strip.
      expect(host.querySelectorAll('[data-testid="live-request-note"]')).toHaveLength(1);
    });
  }

  it("a desktop keeps its one-link note in the console, with no button", async () => {
    mobile.value = false;
    stationAt(EARLY.start + H, [EARLY, ON_THE_HOUR]);
    await mount("night");
    expect(note()?.tagName).toBe("A");
    expect(host.querySelector('[data-testid="live-request-pick"]')).toBeNull();
  });
});
