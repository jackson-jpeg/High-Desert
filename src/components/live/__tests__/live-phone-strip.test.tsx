import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SilentEventSource } from "@/test-support/event-source";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LiveSchedule, ProgramSlot } from "@/lib/live/schedule";
import { formatStationTime } from "@/lib/live/format";

/**
 * A phone's Live screen says ON AIR once and names the show on the air once
 * (2026-10-12). The hero at the top had the lamp and the show; the Studio
 * window under it had a second lamp, and its log's on-air row a third lamp and
 * the title again. Now, under the hero: one strip (the station clock and what
 * is next), then Tonight's log, whose on-air row is a marker.
 *
 * The counts read the rendered text, so the control mounts the desktop studio,
 * which still has the lamp and the title in the console and in the log, and
 * proves the same count finds two of each.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const mobile = vi.hoisted(() => ({ value: true }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/live",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => mobile.value,
  useMediaQuery: () => mobile.value,
}));
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
const DAY_START = Date.UTC(2026, 8, 25, 7); // midnight PT, 2026-09-25 (PDT)

function slot(n: number, start: number, lengthMs: number): ProgramSlot {
  return {
    fileHash: `archive:coll:show-${n}.mp3`,
    episodeId: `coll--show-${n}`,
    title: `Coast to Coast AM - Episode ${n}`,
    airDate: `199${n}-09-25`,
    guestName: `Guest ${n}`,
    showType: "coast",
    duration: lengthMs / 1000,
    sourceUrl: null,
    kind: "on-this-date",
    start,
    end: start + lengthMs,
  };
}

const A = slot(1, DAY_START, 3 * H);
const B = slot(2, A.end + 8_000, 3 * H);
const C = slot(3, B.end + 8_000, 2 * H);
const D = slot(4, C.end + 8_000, 2 * H);
const AT = B.start + H + 500; // an hour into Episode 2

function stationAt(at: number) {
  const schedule: LiveSchedule = {
    day: "2026-09-25",
    tz: "America/Los_Angeles",
    serverNow: at,
    stationIdSec: 8,
    now: { stationId: true, endsAt: at },
    upNext: [C, D],
    rest: [],
    guide: [A, B, C, D],
    outage: false,
  };
  useLiveStore.setState({ clockOffsetMs: at - Date.now(), clockRttMs: 20, schedule });
}

let root: Root;
let host: HTMLDivElement;

async function mount(look: "night" | "win98") {
  act(() => root.render(<LookProvider look={look}><LiveStation /></LookProvider>));
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

/** Every "ON AIR" a reader sees: the lamp's words, in any case, anywhere in the text. */
function onAirCount(): number {
  return (host.textContent ?? "").match(/on air/gi)?.length ?? 0;
}

/** How many times the show on the air is named in the text. */
function titleCount(episode: string): number {
  return (host.textContent ?? "").split(episode).length - 1;
}

const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  mobile.value = true;
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
  useLiveStore.setState({ tuned: false, paused: false, phase: "off", current: null, schedule: null, clockOffsetMs: null });
});

for (const look of ["night", "win98"] as const) {
  describe(`a phone's Live screen says it once (${look})`, () => {
    it("ON AIR once and the show on the air once, both in the hero", async () => {
      stationAt(AT);
      await mount(look);
      const hero = q("live-hero");
      expect(onAirCount()).toBe(1);
      expect(host.querySelectorAll("[data-on-air]")).toHaveLength(1);
      expect(hero.contains(host.querySelector("[data-on-air]"))).toBe(true);
      expect(titleCount("Episode 2")).toBe(1);
      expect(hero.textContent).toContain("Episode 2");
      // No Studio window under the hero any more.
      expect(host.textContent).not.toMatch(/Studio/);
    });

    it("the strip is one row: the station clock (PT) and what is next, with its start time", async () => {
      stationAt(AT);
      await mount(look);
      const strip = q("live-strip");
      expect(strip.contains(q("live-clock"))).toBe(true);
      expect(q("live-clock").textContent).toBe(formatStationTime(AT));
      expect(strip.textContent).toContain("PT");
      const next = q("live-up-next");
      expect(strip.contains(next)).toBe(true);
      expect(next.textContent).toContain(`Up next ${formatStationTime(C.start)}`);
      expect(next.textContent).toContain("Episode 3");
      expect(next.textContent).not.toContain("Episode 4");
      // Not a second now-playing, not a second sign.
      expect(strip.querySelector("[data-on-air]")).toBeNull();
      expect(strip.textContent).not.toContain("Episode 2");
      expect(strip.className).toMatch(/(^|\s)min-h-touch(\s|$)/);
      expect(strip.textContent).not.toMatch(/—/);
    });

    it("the hero comes first, the strip after it, and Tonight's log after the strip", async () => {
      stationAt(AT);
      await mount(look);
      const hero = q("live-hero");
      const strip = q("live-strip");
      const log = q("live-log");
      expect(follows(hero, strip)).toBe(true);
      expect(follows(strip, log)).toBe(true);
      expect(follows(q("live-call-in"), strip)).toBe(true);
      const heading = document.getElementById(log.getAttribute("aria-labelledby") ?? "");
      expect(heading?.textContent).toMatch(/^Tonight's log/);
      expect(log.tabIndex).toBe(0);
    });

    it("the log's on-air row is a marker: its time and 'On the air now', no lamp, no title", async () => {
      stationAt(AT);
      await mount(look);
      const rows = [...q("live-guide").querySelectorAll("li")];
      expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["past", "now", "future", "future"]);
      expect(rows[1].getAttribute("aria-current")).toBe("true");
      expect(rows[1].textContent).toBe(`${formatStationTime(B.start)}On the air now`);
      expect(rows[2].textContent).toContain("Episode 3");
      expect(rows[0].textContent).toContain("Episode 1");
    });

    it("the last show of the day: the strip says so instead of a next show", async () => {
      stationAt(D.start + H);
      await mount(look);
      expect(host.querySelector('[data-testid="live-up-next"]')).toBeNull();
      expect(q("live-strip").textContent).toContain("The last show of the day");
      expect(onAirCount()).toBe(1);
    });
  });
}

describe("the count sees duplicates (control)", () => {
  it("the desktop studio, with the lamp and the show in the console and again in the log, counts two of each", async () => {
    mobile.value = false;
    stationAt(AT);
    await mount("night");
    expect(onAirCount()).toBe(2);
    expect(titleCount("Episode 2")).toBe(2);
    // Desktop is unchanged: no strip, the console's clock and up next.
    expect(host.querySelector('[data-testid="live-strip"]')).toBeNull();
    expect(q("live-up-next").textContent).toContain("Episode 3");
  });
});
