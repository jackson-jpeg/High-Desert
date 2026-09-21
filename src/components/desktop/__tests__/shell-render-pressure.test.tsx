import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * HD-018: the shell must not re-render on the status bar's timers.
 *
 * The clock and the caller-line rotation each tick every 30 s. While their
 * state lived in DesktopShell, every tick re-rendered the shell — rebuilding
 * all four menus and every nav tab to move five characters in a corner. They
 * now live in <StatusBar>.
 *
 * Shell renders are counted through MenuBar, which the shell renders on every
 * pass: the mock wraps the *real* MenuBar and counts calls, so the menu tree is
 * still built. The status bar is real, and the test checks its clock and caller
 * line visibly changed — a shell that stopped re-rendering because nothing
 * ticked any more would otherwise pass. The last test is the control: the shell
 * does still re-render for state it shows.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; the shell measures nav + player height with one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const menuBarRenders = vi.fn();

vi.mock("@/components/win98", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/win98")>();
  return {
    ...actual,
    MenuBar: (props: ComponentProps<typeof actual.MenuBar>) => {
      menuBarRenders();
      return createElement(actual.MenuBar, props);
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/library",
}));
// Network heartbeat; not under test.
vi.mock("@/hooks/usePresence", () => ({
  usePresence: () => ({ online: 0, listening: 0 }),
}));
// IndexedDB reads (streak, show counts, preferences). Not under test, and
// fake-indexeddb schedules on timers this test fakes.
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => undefined }));
vi.mock("@/db", () => ({
  db: {},
  getPreference: () => new Promise(() => {}),
  setPreference: async () => {},
}));
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useMediaQuery: () => false,
}));
// Canvas and requestAnimationFrame.
vi.mock("@/components/desktop/Starfield", () => ({ Starfield: () => null }));

const { DesktopShell } = await import("@/components/desktop/DesktopShell");
const { CALLER_MESSAGES, STATUS_TICK_MS, formatClock } = await import(
  "@/components/desktop/StatusBar"
);
const { usePlayerStore } = await import("@/stores/player-store");

let root: Root;
let container: HTMLDivElement;

// 21:59:50 on a January evening: the first tick crosses into 10:00 PM, and
// January keeps the Halloween badge out of the way.
const START = new Date(2026, 0, 15, 21, 59, 50);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.setSystemTime(START);
  vi.spyOn(Math, "random").mockReturnValue(0);
  usePlayerStore.setState({ currentEpisode: null, playing: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<DesktopShell episodeCount={1312}>{null}</DesktopShell>);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("DesktopShell under the status bar's timers", () => {
  it("does not re-render the shell on clock or caller ticks, while both visibly change", () => {
    const footer = () => container.querySelector("footer")?.textContent ?? "";
    const rendersBefore = menuBarRenders.mock.calls.length;
    expect(rendersBefore).toBeGreaterThan(0);
    expect(footer()).toContain(formatClock(START));
    expect(footer()).toContain(CALLER_MESSAGES[0]);

    // Four ticks: two minutes, plus the caller line's 500 ms fade.
    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(STATUS_TICK_MS);
      });
    }
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(menuBarRenders.mock.calls.length).toBe(rendersBefore);
    expect(footer()).not.toContain(formatClock(START));
    expect(footer()).toContain(formatClock(new Date(START.getTime() + 4 * STATUS_TICK_MS)));
    expect(footer()).not.toContain(CALLER_MESSAGES[0]);
    expect(footer()).toContain(CALLER_MESSAGES[4]);
  });

  it("does not re-render the shell for a status-bar message", () => {
    const rendersBefore = menuBarRenders.mock.calls.length;
    act(() => {
      window.dispatchEvent(new CustomEvent("hd:status-message", { detail: "Sorted by date" }));
    });
    expect(container.querySelector("footer")?.textContent).toContain("Sorted by date");
    expect(menuBarRenders.mock.calls.length).toBe(rendersBefore);
  });

  it("still re-renders for things it does show", () => {
    const rendersBefore = menuBarRenders.mock.calls.length;
    act(() => {
      usePlayerStore.setState({ playing: true });
    });
    expect(menuBarRenders.mock.calls.length).toBeGreaterThan(rendersBefore);
  });
});
