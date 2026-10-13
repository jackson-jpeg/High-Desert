import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EmittingEventSource, SilentEventSource } from "@/test-support/event-source";
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
const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  usePathname: () => "/live",
  useSearchParams: () => new URLSearchParams(nav.search),
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
const { db } = await import("@/db");
const { LookProvider } = await import("@/hooks/useLook");

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

async function mount(look: "night" | "win98" = "night") {
  act(() => root.render(<LookProvider look={look}><LiveStation /></LookProvider>));
  await flush();
}

beforeEach(() => {
  mobile.value = false;
  nav.search = "";
  nav.replace.mockClear();
  EmittingEventSource.instances = [];
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

  it("the day's log scrolls, so a keyboard can reach it, and it is named by its heading", async () => {
    stationAt(B.start + H + 500);
    await mount();
    const log = q("live-log");
    expect(log.tabIndex).toBe(0);
    expect(log.getAttribute("role")).toBe("region");
    const heading = document.getElementById(log.getAttribute("aria-labelledby") ?? "");
    expect(heading?.textContent).toMatch(/^Tonight's log/);
    expect(log.contains(q("live-guide"))).toBe(true);
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

  it("being on screen is the funnel's Live step", async () => {
    localStorage.setItem("hd-funnel", JSON.stringify({ cohort: "2026-09-27", device: "phone", done: ["visit"] }));
    stationAt(B.start + H + 500);
    await mount();
    const posts = vi
      .mocked(fetch)
      .mock.calls.filter((c) => c[0] === "/api/stats/funnel")
      .map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(posts).toEqual([{ step: "live", cohort: "2026-09-27", device: "phone" }]);
    localStorage.clear();
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

  it("a change of show the phone refused: Tap to rejoin, and the lock screen is named as a way back", async () => {
    stationAt(B.start + H + 500);
    await mount();
    act(() => useLiveStore.setState({ tuned: true, paused: true, rejoin: true, phase: "show", current: B }));
    expect(q("live-rejoin").textContent).toBe("Tap to rejoin");
    expect(q("live-status").textContent).toMatch(/lock screen/);
    expect(q("live-status").textContent).not.toMatch(/\u2014/);
    act(() => q("live-rejoin").click());
    expect(controller.tuneIn).toHaveBeenCalledTimes(1);
    // An ordinary pause keeps the ordinary words.
    act(() => useLiveStore.setState({ rejoin: false }));
    expect(q("live-rejoin").textContent).toBe("Rejoin live");
  });

  it("the layout lets each window fit: one shrinkable column on a phone; the chat fills its window", async () => {
    // Measured for real in e2e/live-qa.spec.ts ("wider than the screen", "the
    // call-in box is on screen"); jsdom has no layout, so this holds the two
    // declarations that did it. At 390 an implicit grid track sized to the
    // "Up next" title made the studio 555 px wide; as flex-1 in a scrolling
    // Window body, the chat pushed its call-in box below the fold.
    stationAt(B.start + H + 500);
    await mount();
    const grid = q("live-guide").closest('[class*="grid"]')!;
    expect(grid.className).toMatch(/(^|\s)grid-cols-\[minmax\(0,1fr\)\](\s|$)/);
    expect(q("phone-lines-body").className).toMatch(/(^|\s)h-full(\s|$)/);
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
      // The chat itself is in the sheet; the screen shows a preview of it.
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

  for (const look of ["night", "win98"] as const) {
    describe(`a phone's Live screen (${look})`, () => {
      beforeEach(() => {
        mobile.value = true;
      });

      it("opens on the show on the air: one Listen live button, the show, its guest and year, the count", async () => {
        stationAt(B.start + H + 500);
        await mount(look);
        const hero = q("live-hero");
        // First in the column, above the phone lines and the studio.
        const firsts = [...hero.parentElement!.children].filter((c) => /(^|\s)order-first(\s|$)/.test(c.className));
        expect(firsts).toEqual([hero]);
        // One way in, not two: the studio's own Tune in gives way to it.
        const listen = host.querySelectorAll<HTMLElement>('[data-testid="live-tune-in"]');
        expect(listen).toHaveLength(1);
        expect(hero.contains(listen[0])).toBe(true);
        expect(listen[0].textContent).toContain("Listen live");
        expect(listen[0].getAttribute("aria-label")).toBe("Listen live: Show 2");
        // The show is the hero's, not repeated in the studio below it.
        expect(host.querySelectorAll('[data-testid="live-now-title"]')).toHaveLength(1);
        expect(hero.contains(q("live-now-title"))).toBe(true);
        expect(q("live-now-title").textContent).toBe("Show 2");
        expect(q("live-now-meta").textContent).toBe("with Guest 2 · 1992");
        expect(q("live-time-left").textContent).toBe("−1:59:59");
        const count = q("listen-count");
        expect(count.textContent).toBe("5 tuned in now");
        expect(count.getAttribute("data-presence")).toBe("live");
        expect(hero.textContent).not.toMatch(/\u2014/);

        act(() => listen[0].click());
        expect(controller.tuneIn).toHaveBeenCalledTimes(1);
      });

      it("tuned in, the button's place says so and holds Leave the station; held, it is Rejoin", async () => {
        stationAt(B.start + H + 500);
        await mount(look);
        act(() => useLiveStore.setState({ tuned: true, phase: "show" }));
        const hero = q("live-hero");
        expect(host.querySelector('[data-testid="live-tune-in"]')).toBeNull();
        expect(hero.contains(q("live-listening"))).toBe(true);
        const leave = [...hero.querySelectorAll("button")].filter((b) => b.textContent === "Leave the station");
        expect(leave).toHaveLength(1);
        // The only Leave on the screen: the studio below has no controls of its own.
        expect([...host.querySelectorAll("button")].filter((b) => b.textContent === "Leave the station")).toHaveLength(1);
        act(() => leave[0].click());
        expect(controller.leaveStation).toHaveBeenCalledTimes(1);

        act(() => useLiveStore.setState({ paused: true, rejoin: true, current: B }));
        expect(hero.contains(q("live-rejoin"))).toBe(true);
        expect(q("live-rejoin").textContent).toBe("Tap to rejoin");
        expect(host.querySelector('[data-testid="live-listening"]')).toBeNull();
        act(() => q("live-rejoin").click());
        expect(controller.tuneIn).toHaveBeenCalledTimes(1);
      });

      it("the hook is the catalog's own words: the show's summary, first sentence", async () => {
        await db.episodes.clear();
        await db.episodes.add({
          fileHash: B.fileHash,
          fileName: "show-2.mp3",
          title: "Show 2",
          aiSummary: "Guest 2 explains the lights over Phoenix. Then open lines.",
        } as never);
        try {
          stationAt(B.start + H + 500);
          await mount(look);
          await vi.waitFor(() => expect(q("live-hook").textContent).toBe("Guest 2 explains the lights over Phoenix."));
          expect(q("live-hero").contains(q("live-hook"))).toBe(true);
        } finally {
          await db.episodes.clear();
        }
      });

      it("no summary, no hook: nothing is made up", async () => {
        await db.episodes.clear();
        stationAt(B.start + H + 500);
        await mount(look);
        expect(host.querySelector('[data-testid="live-hook"]')).toBeNull();
      });

      it("the latest calls are on the first screen, and the sheet shares their stream", async () => {
        vi.stubGlobal("EventSource", EmittingEventSource);
        stationAt(B.start + H + 500);
        await mount(look);
        expect(q("phone-lines-preview").textContent).toContain("Be the first caller tonight");
        const calls = [1, 2, 3, 4, 5].map((id) => ({
          id,
          at: "2026-09-25T09:00:00.000Z",
          name: `Caller ${id}`,
          line: "Line 3",
          body: `call number ${id}`,
          place: null,
        }));
        act(() =>
          EmittingEventSource.last()!.emit("hello", {
            you: { name: "Night Owl", line: "Line 3", admin: false },
            slowMode: { on: false, until: null, intervalMs: 3000, forced: false },
            recent: calls,
            resumed: false,
            hidden: [],
          }),
        );
        const preview = [...host.querySelectorAll('[data-testid="preview-call"]')].map((el) => el.textContent);
        expect(preview).toHaveLength(3);
        expect(preview.join(" ")).toContain("call number 5");
        expect(preview.join(" ")).not.toContain("call number 2");
        const streams = EmittingEventSource.instances.length;
        expect(streams).toBe(1);

        act(() => q("phone-lines-preview").click());
        const sheet = q("live-chat-sheet");
        // The whole room is in the sheet, from the same stream: no second connection.
        expect(sheet.querySelectorAll('[data-testid="live-message"]')).toHaveLength(5);
        expect(EmittingEventSource.instances.length).toBe(streams);
      });

      it("the preview draws each call as a block (name, place and line, then the message) and tints the caller's own", async () => {
        vi.stubGlobal("EventSource", EmittingEventSource);
        stationAt(B.start + H + 500);
        await mount(look);
        act(() =>
          EmittingEventSource.last()!.emit("hello", {
            you: { name: "Night Owl", line: "Line 3", admin: false },
            slowMode: { on: false, until: null, intervalMs: 3000, forced: false },
            recent: [
              { id: 1, at: "2026-09-25T09:00:00.000Z", name: "Desert Rat", line: "Area 51 Line", body: "a very long call ".repeat(12), place: "Rachel" },
              { id: 2, at: "2026-09-25T09:01:00.000Z", name: "Night Owl", line: "Line 3", body: "mine", place: null },
            ],
            resumed: false,
            hidden: [],
          }),
        );
        const [theirs, own] = [...host.querySelectorAll<HTMLElement>('[data-testid="preview-call"]')];
        const name = theirs.querySelector('[data-testid="caller-name"]')!;
        const body = theirs.querySelector('[data-testid="message-body"]')!;
        expect(name.textContent).toBe("Desert Rat");
        expect(name.className).toContain("font-bold");
        expect(name.parentElement!.textContent!.replace(/\u00A0/g, " ")).toBe("Desert Rat, calling from Rachel \u00B7 Area 51 Line");
        expect(name.contains(body) || name.parentElement!.contains(body)).toBe(false);
        expect(own.dataset.mine).toBe("true");
        expect(theirs.dataset.mine).toBeUndefined();
      });

      it("/live?lines=1 (the Phone Lines tab) opens the sheet, then leaves the address bar", async () => {
        nav.search = "lines=1";
        stationAt(B.start + H + 500);
        await mount(look);
        expect(host.querySelector('[data-testid="live-chat-sheet"]')).not.toBeNull();
        expect(nav.replace).toHaveBeenCalledWith("/live", { scroll: false });
      });
    });
  }

  it("desktop: /live?lines=1 puts the cursor in the call box", async () => {
    nav.search = "lines=1";
    stationAt(B.start + H + 500);
    await mount();
    expect(host.querySelector('[data-testid="live-chat-sheet"]')).toBeNull();
    expect((document.activeElement as HTMLElement | null)?.getAttribute("aria-label")).toBe("Your call");
    expect(nav.replace).toHaveBeenCalledWith("/live", { scroll: false });
  });

  it("desktop keeps the studio's Tune in, beside the show, and no hero", async () => {
    stationAt(B.start + H + 500);
    await mount();
    expect(host.querySelectorAll('[data-testid="live-tune-in"]')).toHaveLength(1);
    expect(q("live-tune-in").textContent).toBe("Tune in");
    expect(host.querySelector('[data-testid="live-hero"]')).toBeNull();
    expect(host.querySelector('[data-testid="phone-lines-preview"]')).toBeNull();
  });
});
