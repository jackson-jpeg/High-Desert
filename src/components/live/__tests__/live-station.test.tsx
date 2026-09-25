import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SilentEventSource } from "@/test-support/event-source";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LiveSchedule, ProgramSlot } from "@/lib/live/schedule";

/**
 * The Live screen, mounted for real against one published schedule.
 *
 * Everything it shows is computed from the schedule and the station clock, so
 * the clock is pinned (the store's `clockOffsetMs`, which is what `serverNow`
 * reads) at a known instant inside the second show, and each number is checked
 * against that instant: the show on the air, its time left, what is next, and
 * which rows of the log are past, on, and to come. The listener count comes
 * from the one presence feed — the fixture's `/api/stats/now` — and nowhere else.
 *
 * `tuneIn` is replaced (it is the controller's, tested in
 * src/audio/__tests__/live-station.test.ts); here the question is only whether
 * the button reaches it.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const mobile = vi.hoisted(() => ({ value: false }));
const controller = vi.hoisted(() => ({ tuneIn: vi.fn(), leaveStation: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/live",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => mobile.value,
  useMediaQuery: () => mobile.value,
}));
vi.mock("@/audio/live-controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/audio/live-controller")>()),
  tuneIn: controller.tuneIn,
  leaveStation: controller.leaveStation,
}));

const { LiveStation } = await import("@/components/live/LiveStation");
const { useLiveStore } = await import("@/stores/live-store");
const { resetNowFeedForTests } = await import("@/services/stats/now-feed");

const NOW = { online: 8, listening: 3, live: 5, onAir: [], recent: [] };

const H = 3_600_000;
const DAY_START = Date.UTC(2026, 8, 25, 7); // midnight PT, 2026-09-25 (PDT)

function slot(n: number, start: number, lengthMs: number, over: Partial<ProgramSlot> = {}): ProgramSlot {
  return {
    fileHash: `archive:coll:show-${n}.mp3`,
    episodeId: `coll--show-${n}`,
    title: `Show ${n}`,
    airDate: `199${n}-09-25`,
    guestName: `Guest ${n}`,
    showType: "coast",
    duration: lengthMs / 1000,
    sourceUrl: null,
    kind: "on-this-date",
    start,
    end: start + lengthMs,
    ...over,
  };
}

const A = slot(1, DAY_START, 3 * H);
const B = slot(2, A.end + 8_000, 3 * H);
const C = slot(3, B.end + 8_000, 2 * H, { kind: "fan-favorite" });
const D = slot(4, C.end + 8_000, 2 * H, { kind: "fan-favorite" });

function schedule(at: number): LiveSchedule {
  return {
    day: "2026-09-25",
    tz: "America/Los_Angeles",
    serverNow: at,
    stationIdSec: 8,
    now: { stationId: true, endsAt: at }, // not read by the screen; it locates from the guide
    upNext: [C, D],
    rest: [],
    guide: [A, B, C, D],
    outage: false,
  };
}

/** Pin the station clock at `at`: `serverNow()` is Date.now() + the offset. */
function stationAt(at: number) {
  useLiveStore.setState({ clockOffsetMs: at - Date.now(), clockRttMs: 20, schedule: schedule(at) });
}

let root: Root;
let host: HTMLDivElement;

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

function q(testId: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`no [data-testid="${testId}"]`);
  return el;
}

async function mount() {
  act(() => root.render(<LiveStation />));
  await flush();
}

beforeEach(() => {
  mobile.value = false;
  controller.tuneIn.mockClear();
  controller.leaveStation.mockClear();
  resetNowFeedForTests();
  useLiveStore.setState({ tuned: false, phase: "off", current: null, schedule: null, clockOffsetMs: null, drift: null });
  vi.stubGlobal("EventSource", SilentEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.startsWith("/api/stats/now")) return new Response(JSON.stringify(NOW), { status: 200 });
      return new Response("{}", { status: 404 });
    }),
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
  useLiveStore.setState({ tuned: false, paused: false, phase: "off", current: null, schedule: null, clockOffsetMs: null });
});

describe("Live screen", () => {
  it("shows the show on the air, its time left, what is next, and the log's past/now/future", async () => {
    // One hour (and half a second) into show B, which runs three hours.
    stationAt(B.start + H + 500);
    await mount();

    expect(q("live-now-title").textContent).toBe("Show 2");
    expect(q("live-time-left").textContent).toBe("−1:59:59");
    expect(q("live-up-next").textContent).toContain("Show 3");
    expect(q("live-up-next").textContent).not.toContain("Show 4");

    const rows = [...q("live-guide").querySelectorAll("li")];
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["past", "now", "future", "future"]);
    expect(rows[1].getAttribute("aria-current")).toBe("true");
    expect(rows[1].textContent).toContain("Show 2");
    expect(host.querySelector('[data-on-air="lit"]')).not.toBeNull();
  });

  it("the heading is the episode; the show it belongs to goes in the kicker", async () => {
    // Every catalog title leads with the show, so "Coast to Coast AM - …" was
    // the studio's heading for every Coast broadcast.
    const at = B.start + H;
    const titled = { ...B, title: "Coast to Coast AM - September 11th Coverage" };
    useLiveStore.setState({
      clockOffsetMs: at - Date.now(),
      clockRttMs: 20,
      schedule: { ...schedule(at), guide: [A, titled, C, D] },
    });
    await mount();
    const heading = q("live-now-title");
    expect(heading.tagName).toBe("H2");
    expect(heading.textContent).toBe("September 11th Coverage");
    expect(q("live-now-show").textContent).toBe("Now playing · Coast to Coast AM");
  });

  it("a station break between shows: no title of a show, a countdown to the next", async () => {
    stationAt(B.end + 2_500); // 2.5 s into the eight-second gap
    await mount();
    expect(q("live-now-title").textContent).toBe("You're listening to High Desert");
    expect(q("live-time-left").textContent).toBe("Next show in 0:05");
    expect(q("live-up-next").textContent).toContain("Show 3");
    const rows = [...q("live-guide").querySelectorAll("li")];
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["past", "past", "future", "future"]);
  });

  it("the listener count is the presence feed's, on the live surface", async () => {
    stationAt(B.start + H + 500);
    await mount();
    const el = q("live-listeners");
    expect(el.getAttribute("data-presence")).toBe("live");
    expect(el.getAttribute("data-live")).toBe("5");
    expect(el.getAttribute("data-online")).toBe("8");
    expect(el.textContent?.match(/\d+/g)?.map(Number)).toEqual([5, 8]);
  });

  it("Tune in reaches the station controller", async () => {
    stationAt(B.start + H + 500);
    await mount();
    act(() => q("live-tune-in").click());
    expect(controller.tuneIn).toHaveBeenCalledTimes(1);
    // Tuned in, the button is the way out.
    act(() => useLiveStore.setState({ tuned: true, phase: "show" }));
    expect(host.querySelector('[data-testid="live-tune-in"]')).toBeNull();
    const leave = [...host.querySelectorAll("button")].find((b) => b.textContent === "Leave the station");
    act(() => leave!.click());
    // Leaving, not just tuning out: it is the call that stops the player.
    expect(controller.leaveStation).toHaveBeenCalledTimes(1);
  });

  it("held paused: the studio says so, and offers to rejoin as well as to leave", async () => {
    stationAt(B.start + H + 500);
    await mount();
    act(() => useLiveStore.setState({ tuned: true, paused: true, phase: "show", current: B }));
    expect(q("live-status").textContent).toMatch(/^Paused/);
    act(() => q("live-rejoin").click());
    expect(controller.tuneIn).toHaveBeenCalledTimes(1);
    act(() => useLiveStore.setState({ paused: false }));
    expect(host.querySelector('[data-testid="live-rejoin"]')).toBeNull();
  });

  it("desktop: the phone lines sit beside the console", async () => {
    stationAt(B.start + H + 500);
    await mount();
    const slot = q("phone-lines");
    const guide = q("live-guide");
    expect(host.querySelector('[data-testid="live-chat-sheet"]')).toBeNull();
    // Beside, not inside: the chat is not in the studio window.
    expect(guide.closest('[class*="grid"]')!.contains(slot)).toBe(true);
    expect(guide.parentElement!.contains(slot)).toBe(false);
    // And the phone lines are really in it: the chat opened its stream.
    expect(SilentEventSource.opened.some((u) => u.includes("/live-api/stream"))).toBe(true);
  });

  it("mobile: the phone lines are a sheet sized from the visual viewport", async () => {
    mobile.value = true;
    const vv = Object.assign(new EventTarget(), { height: 500, offsetTop: 0, width: 390 });
    vi.stubGlobal("visualViewport", vv);
    const innerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    try {
      stationAt(B.start + H + 500);
      await mount();
      expect(host.querySelector('[data-testid="phone-lines"]')).toBeNull();
      const call = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Phone lines are open"));
      act(() => call!.click());
      const sheet = q("live-chat-sheet");
      expect(sheet.querySelector('[data-testid="phone-lines"]')).not.toBeNull();
      // The keyboard covers 300px of an 800px layout viewport: the sheet
      // sits on top of it and takes 85% of what is left.
      expect(sheet.style.bottom).toBe("300px");
      expect(sheet.style.height).toBe("425px");
      // The keyboard closes.
      act(() => {
        vv.height = 800;
        vv.dispatchEvent(new Event("resize"));
      });
      expect(sheet.style.bottom).toBe("0px");
      expect(sheet.style.height).toBe("680px");
    } finally {
      Object.defineProperty(window, "innerHeight", { value: innerHeight, configurable: true });
    }
  });
});
