import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onHdEvent } from "@/lib/events";
import type { Episode } from "@/db/schema";

/**
 * HD-011 on /radio: the real RadioDial, with its real controls.
 *
 * Its window keydown handler skipped only inputs, so Enter and Space were
 * captured everywhere — Enter on a focused "Scan forward" button seeked the
 * dial instead, and `preventDefault()` meant the button never fired.
 *
 * jsdom runs no default actions, so "the button activates" is observed as the
 * browser decides it: the keydown was not default-prevented. The dial's own
 * effects are observed on the real store and the real play event. Each
 * negative has a control on the body proving the handler is mounted and would
 * have acted.
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
// Web Audio static and the canvas strip: not under test, and jsdom has neither.
vi.mock("@/audio/radio-static", () => ({
  initRadioStatic: vi.fn(),
  setStaticVolume: vi.fn(),
  muteStatic: vi.fn(),
  playLockTone: vi.fn(),
  destroyRadioStatic: vi.fn(),
  isRadioStaticInitialized: () => true,
}));
vi.mock("@/components/radio/TuningStrip", () => ({ TuningStrip: () => null }));
// The signal meter draws on a canvas; jsdom logs on every getContext call.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const { RadioDial } = await import("@/components/radio/RadioDial");
const { useRadioDialStore } = await import("@/stores/radio-dial-store");

const EPISODES = [
  { id: 1, title: "Men in Black", airDate: "1997-07-28", showType: "coast" },
  { id: 2, title: "Hoagland on Mars", airDate: "1998-03-02", showType: "coast" },
] as unknown as Episode[];

let root: Root;
let container: HTMLDivElement;
let plays: string[];
// Plays are counted from the typed bus (src/lib/events.ts), the same
// "play-episode" the library and dial emit — not a raw window name that could
// drift from the transport and leave every "nothing played" passing blind.
let offPlay = () => {};
const onPlayEvent = (ep: Episode) => {
  plays.push(ep?.title ?? "?");
};

function press(el: Element, code: string, key = code): boolean {
  const ev = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(ev); });
  return ev.defaultPrevented;
}

function control(label: string): HTMLButtonElement {
  const b = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!b) throw new Error(`no button "${label}"`);
  return b;
}

beforeEach(() => {
  plays = [];
  offPlay = onHdEvent("play-episode", onPlayEvent);
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  useRadioDialStore.setState({
    position: 100, lockedEpisode: EPISODES[0], signalStrength: 1, scanning: null, subStationIndex: 0,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(createElement(RadioDial, { episodes: EPISODES })); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  offPlay();
  useRadioDialStore.getState().stopScan();
});

describe("RadioDial — keys a focused control owns", () => {
  it("control: arrows, Enter and Space on the page drive the dial", () => {
    // lockedEpisode/position may have been reconciled on mount; pin them again.
    act(() => useRadioDialStore.setState({ position: 100, lockedEpisode: EPISODES[0] }));
    expect(press(document.body, "ArrowRight")).toBe(true);
    expect(useRadioDialStore.getState().position).toBe(101);
    expect(press(document.body, "Enter")).toBe(true);
    act(() => useRadioDialStore.setState({ lockedEpisode: EPISODES[0] }));
    expect(press(document.body, "Space", " ")).toBe(true);
    expect(plays).toEqual(["Men in Black"]);
  });

  it("Enter/Space on a focused dial button are the button's", () => {
    act(() => useRadioDialStore.setState({ position: 100, lockedEpisode: EPISODES[0] }));
    for (const label of ["Scan forward", "Seek to nearest station", "Scan backward"]) {
      const b = control(label);
      b.focus();
      expect(press(b, "Enter"), `${label} Enter`).toBe(false);
      expect(press(b, "Space", " "), `${label} Space`).toBe(false);
    }
    expect(useRadioDialStore.getState().position).toBe(100);
    expect(plays).toEqual([]);
  });

  it("arrows still tune the dial with a dial button focused (as after a mouse click)", () => {
    // Chromium focuses a button on click. A button does nothing with an
    // arrow, so owning arrows there would only make the dial untunable
    // after clicking Scan or Seek.
    act(() => useRadioDialStore.setState({ position: 100 }));
    for (const label of ["Scan forward", "Seek to nearest station", "Scan backward"]) {
      const b = control(label);
      b.focus();
      expect(press(b, "ArrowRight"), `${label} ArrowRight`).toBe(true);
    }
    expect(useRadioDialStore.getState().position).toBe(103);
    const b = control("Scan forward");
    b.focus();
    expect(press(b, "ArrowLeft")).toBe(true);
    expect(useRadioDialStore.getState().position).toBe(102);
  });

  it("a focused year tab owns Enter", () => {
    act(() => useRadioDialStore.setState({ position: 100 }));
    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]')!;
    tab.focus();
    expect(press(tab, "Enter")).toBe(false);
    expect(useRadioDialStore.getState().position).toBe(100);
  });

  it("keys inside a dialog or menu are ignored by the dial", () => {
    act(() => useRadioDialStore.setState({ position: 100, lockedEpisode: EPISODES[0] }));
    for (const role of ["dialog", "menu"]) {
      const host = document.createElement("div");
      host.setAttribute("role", role);
      const inner = document.createElement("div");
      inner.tabIndex = 0;
      host.appendChild(inner);
      document.body.appendChild(host);
      expect(press(inner, "ArrowRight")).toBe(false);
      expect(press(inner, "Space", " ")).toBe(false);
      host.remove();
    }
    expect(useRadioDialStore.getState().position).toBe(100);
    expect(plays).toEqual([]);
  });
});
