import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onHdEvent } from "@/lib/events";
import type { Episode } from "@/db/schema";

/**
 * The Library's Dial mode (preview looks): the real LibraryDial, the real
 * radio store, the real dial keys and the real List / Dial state. Only the
 * Web Audio static and the canvas strip are stubbed (jsdom has neither).
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let mobile = false;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/library",
}));
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => mobile,
  useMediaQuery: () => mobile,
}));
vi.mock("@/audio/radio-static", () => ({
  initRadioStatic: vi.fn(),
  setStaticVolume: vi.fn(),
  muteStatic: vi.fn(),
  playLockTone: vi.fn(),
  destroyRadioStatic: vi.fn(),
  isRadioStaticInitialized: () => true,
}));
vi.mock("@/components/radio/TuningStrip", () => ({ TuningStrip: () => null }));
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const { LibraryDial, AUTO_OPEN_DELAY_MS } = await import("@/components/library/LibraryDial");
const { useRadioDialStore } = await import("@/stores/radio-dial-store");
const { dialOwnsKeys } = await import("@/hooks/useRadioDialKeys");
const { useLibraryView, LIBRARY_VIEW_KEY } = await import("@/hooks/library/useLibraryView");

const EPISODES = [
  { id: 1, title: "Coast to Coast AM - Men in Black", airDate: "1997-07-28", showType: "coast", guestName: "Jim Keith" },
  { id: 2, title: "Coast to Coast AM - Hoagland on Mars", airDate: "1998-03-02", showType: "coast" },
] as unknown as Episode[];
// Day 0 is the earliest show; the second is 217 days later.
const DAY_OF_SECOND = 217;

let root: Root;
let container: HTMLDivElement;
let plays: string[];
let stops: number;
let offs: (() => void)[] = [];

function mount(props: Partial<React.ComponentProps<typeof LibraryDial>> = {}) {
  const all = {
    episodes: EPISODES,
    selectedEpisode: null,
    autoOpen: true,
    onOpen: vi.fn(),
    onEscape: vi.fn(),
    ...props,
  };
  act(() => root.render(createElement(LibraryDial, all)));
  return all as typeof all & { onOpen: ReturnType<typeof vi.fn>; onEscape: ReturnType<typeof vi.fn> };
}

function press(code: string, key = code): boolean {
  const ev = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true });
  act(() => { document.body.dispatchEvent(ev); });
  return ev.defaultPrevented;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mobile = false;
  plays = [];
  stops = 0;
  offs = [
    onHdEvent("play-episode", (ep) => plays.push(ep.title ?? "?")),
    onHdEvent("scan-preview-stop", () => { stops++; }),
  ];
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  useRadioDialStore.setState({ position: 50, lockedEpisode: null, signalStrength: 0, scanning: null, subStationIndex: 0 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  offs.forEach((off) => off());
  useRadioDialStore.getState().stopScan();
  vi.useRealTimers();
});

describe("LibraryDial", () => {
  it("renders the dial with its look hooks", () => {
    mount();
    for (const hook of ["hd-dial", "hd-dial-readout", "hd-dial-strip", "hd-dial-needle", "hd-dial-controls", "hd-dial-station"]) {
      expect(container.querySelector(`.${hook}`), hook).not.toBeNull();
    }
  });

  it("starts on the show the listener had open", () => {
    mount({ selectedEpisode: EPISODES[1] });
    expect(useRadioDialStore.getState().position).toBe(DAY_OF_SECOND);
    expect(useRadioDialStore.getState().lockedEpisode?.id).toBe(2);
  });

  it("on a wide screen, a show the dial rests on opens in the detail panel, once", () => {
    const { onOpen } = mount();
    act(() => useRadioDialStore.getState().setPosition(DAY_OF_SECOND));
    expect(onOpen).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS); });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe(2);
    // The library's rows are re-read (a favourite toggled, the panel closed):
    // fresh objects for the same shows. The dial still rests on show 2, and
    // it does not open again.
    mount({ onOpen, episodes: EPISODES.map((e) => ({ ...e })) });
    expect(useRadioDialStore.getState().lockedEpisode).not.toBe(EPISODES[1]);
    act(() => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS * 2); });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("dragging past a show does not open it", () => {
    const { onOpen } = mount();
    act(() => useRadioDialStore.getState().setPosition(DAY_OF_SECOND));
    act(() => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS / 2); });
    act(() => useRadioDialStore.getState().setPosition(100));
    act(() => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS * 2); });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("on a phone nothing opens by itself; Details opens the locked show", () => {
    mobile = true;
    const { onOpen } = mount({ autoOpen: false });
    act(() => useRadioDialStore.getState().setPosition(0));
    act(() => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS * 2); });
    expect(onOpen).not.toHaveBeenCalled();
    const details = container.querySelector<HTMLButtonElement>('[data-testid="dial-open-details"]')!;
    expect(container.querySelector('[data-testid="dial-station"]')?.textContent).toContain("Men in Black");
    act(() => details.click());
    expect(onOpen).toHaveBeenCalledWith(EPISODES[0]);
  });

  it("owns the keys while mounted: Space plays the locked show through the bus, Escape goes back", () => {
    expect(dialOwnsKeys()).toBe(false);
    const { onEscape } = mount();
    expect(dialOwnsKeys()).toBe(true);
    act(() => useRadioDialStore.getState().setPosition(0));
    expect(press("Space", " ")).toBe(true);
    expect(plays).toEqual(["Coast to Coast AM - Men in Black"]);
    expect(press("ArrowRight")).toBe(true);
    expect(useRadioDialStore.getState().position).toBe(1);
    press("Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    expect(dialOwnsKeys()).toBe(false);
    root = createRoot(container);
  });

  it("leaving Dial mode stops a scan and its preview", () => {
    mount();
    act(() => useRadioDialStore.getState().startScan("forward"));
    expect(useRadioDialStore.getState().scanning).toBe("forward");
    act(() => root.unmount());
    expect(useRadioDialStore.getState().scanning).toBeNull();
    expect(stops).toBeGreaterThan(0);
    root = createRoot(container);
  });

  it("says so when the filters leave nothing to tune to", () => {
    const onClearFilters = vi.fn();
    mount({ episodes: [], onClearFilters });
    expect(container.textContent).toContain("Nothing on the dial");
    const clear = [...container.querySelectorAll("button")].find((b) => b.textContent === "Clear filters")!;
    act(() => clear.click());
    expect(onClearFilters).toHaveBeenCalled();
  });
});

describe("useLibraryView: List or Dial", () => {
  let view: ReturnType<typeof useLibraryView>;
  const capture = (v: ReturnType<typeof useLibraryView>) => { view = v; };
  function Probe({ look, onView = capture }: { look: "default" | "clean" | "win98"; onView?: typeof capture }) {
    onView(useLibraryView(look));
    return null;
  }
  const setLook = (look: string | null) => {
    if (look) document.documentElement.setAttribute("data-look", look);
    else document.documentElement.removeAttribute("data-look");
  };

  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => setLook(null));

  it("control: the public look is always the list, and keeps nothing", () => {
    setLook(null);
    act(() => root.render(createElement(Probe, { look: "default" })));
    expect(view.available).toBe(false);
    act(() => view.setView("dial"));
    expect(view.view).toBe("list");
    expect(window.sessionStorage.getItem(LIBRARY_VIEW_KEY)).toBeNull();
  });

  it("a preview look switches to the dial and remembers it for the tab", () => {
    setLook("clean");
    act(() => root.render(createElement(Probe, { look: "clean" })));
    expect(view.available).toBe(true);
    expect(view.view).toBe("list");
    act(() => view.setView("dial"));
    expect(view.view).toBe("dial");
    expect(window.sessionStorage.getItem(LIBRARY_VIEW_KEY)).toBe("dial");
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(createElement(Probe, { look: "win98" })));
    expect(view.view).toBe("dial");
  });

  it("the page's look decides, even while the hook still answers the public look (hydration)", () => {
    setLook("clean");
    act(() => root.render(createElement(Probe, { look: "default" })));
    act(() => view.setView("dial"));
    expect(view.view).toBe("list");
    act(() => root.render(createElement(Probe, { look: "clean" })));
    expect(view.view).toBe("dial");
  });
});
