import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";

/**
 * The radio's year bar is an ARIA tablist; it now keeps the tabs contract.
 *
 * It had `role="tablist"`/`role="tab"` and no key handling. The key-ownership
 * guard gives a tablist its own arrows (that *is* the tabs pattern), so the
 * dial's window handler stood aside — and after clicking a year, Left/Right
 * did nothing at all. Mounted in the real RadioDial against the real store,
 * so "the arrows tune to the next year" is observed on the dial's position,
 * and "the dial's own arrows stayed out" on the same number.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/radio",
}));
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useMediaQuery: () => false,
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

const { RadioDial } = await import("@/components/radio/RadioDial");
const { useRadioDialStore } = await import("@/stores/radio-dial-store");

const EPISODES = [
  { id: 1, title: "A", airDate: "1995-05-01", showType: "coast" },
  { id: 2, title: "B", airDate: "1996-05-01", showType: "coast" },
  { id: 3, title: "C", airDate: "1997-05-01", showType: "coast" },
  { id: 4, title: "D", airDate: "1998-05-01", showType: "coast" },
] as unknown as Episode[];

let root: Root;
let container: HTMLDivElement;

function tabs(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]'));
}
function tab(year: number): HTMLButtonElement {
  const t = tabs().find((b) => b.dataset.year === String(year));
  if (!t) throw new Error(`no tab for ${year}`);
  return t;
}
function selectedYears(): string[] {
  return tabs().filter((t) => t.getAttribute("aria-selected") === "true").map((t) => t.dataset.year!);
}
function inTabOrder(): string[] {
  return tabs().filter((t) => t.tabIndex === 0).map((t) => t.dataset.year!);
}
function press(el: Element, key: string): boolean {
  const ev = new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(ev); });
  return ev.defaultPrevented;
}
/** The dial position a click on that year's tab lands on — measured, not re-derived. */
function positionOf(year: number): number {
  act(() => { tab(year).click(); });
  return useRadioDialStore.getState().position;
}

beforeEach(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  useRadioDialStore.setState({ position: 0, lockedEpisode: null, signalStrength: 1, scanning: null, subStationIndex: 0 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(createElement(RadioDial, { episodes: EPISODES })); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useRadioDialStore.getState().stopScan();
});

describe("radio year tabs — the ARIA tabs keyboard pattern", () => {
  it("one tab is selected and only it is in the Tab order (roving tabindex)", () => {
    expect(tabs().map((t) => t.dataset.year)).toEqual(["1995", "1996", "1997", "1998"]);
    positionOf(1996);
    expect(selectedYears()).toEqual(["1996"]);
    expect(inTabOrder()).toEqual(["1996"]);
  });

  it("after clicking a year, Left/Right move to and tune the neighbouring years", () => {
    const at = Object.fromEntries([1995, 1996, 1997, 1998].map((y) => [y, positionOf(y)]));
    expect(new Set(Object.values(at)).size).toBe(4);

    positionOf(1996);
    tab(1996).focus();
    expect(press(tab(1996), "ArrowRight")).toBe(true);
    expect(useRadioDialStore.getState().position).toBe(at[1997]);
    expect(document.activeElement).toBe(tab(1997));
    expect(selectedYears()).toEqual(["1997"]);
    expect(inTabOrder()).toEqual(["1997"]);

    expect(press(tab(1997), "ArrowLeft")).toBe(true);
    expect(press(tab(1996), "ArrowLeft")).toBe(true);
    expect(useRadioDialStore.getState().position).toBe(at[1995]);
    expect(document.activeElement).toBe(tab(1995));
    // Wraps, as tabs do.
    expect(press(tab(1995), "ArrowLeft")).toBe(true);
    expect(document.activeElement).toBe(tab(1998));
    expect(useRadioDialStore.getState().position).toBe(at[1998]);
  });

  it("Home and End go to the first and last year", () => {
    const first = positionOf(1995);
    const last = positionOf(1998);
    positionOf(1996);
    tab(1996).focus();
    expect(press(tab(1996), "End")).toBe(true);
    expect(useRadioDialStore.getState().position).toBe(last);
    expect(document.activeElement).toBe(tab(1998));
    expect(press(tab(1998), "Home")).toBe(true);
    expect(useRadioDialStore.getState().position).toBe(first);
    expect(document.activeElement).toBe(tab(1995));
  });

  it("control: with nothing focused the dial's arrows still tune by one day", () => {
    const start = positionOf(1996);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(press(document.body, "ArrowRight")).toBe(true);
    expect(useRadioDialStore.getState().position).toBe(start + 1);
  });
});
