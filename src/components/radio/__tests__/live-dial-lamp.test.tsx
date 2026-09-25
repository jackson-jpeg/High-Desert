import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProgramSlot } from "@/lib/live/schedule";

/**
 * The ON AIR lamp on the radio dial: it names the show the station is playing,
 * and a tap tunes in and swings the needle to that show's day on the dial —
 * the same day index the dial's own stations use (`dateToDayIndex` in
 * useRadioDial), which is what puts the needle on the show's tick.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const controller = vi.hoisted(() => ({ tuneIn: vi.fn() }));
vi.mock("@/audio/live-controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/audio/live-controller")>()),
  tuneIn: controller.tuneIn,
}));

const { LiveDialLamp, airDateDayIndex } = await import("@/components/radio/LiveDialLamp");
const { useRadioDialStore } = await import("@/stores/radio-dial-store");
const { useLiveStore } = await import("@/stores/live-store");

const EARLIEST = new Date("1988-01-01T00:00:00");

const SLOT: ProgramSlot = {
  fileHash: "archive:coll:1997-09-25.mp3",
  episodeId: "coll--1997-09-25",
  title: "Coast to Coast — Sept 25 1997",
  airDate: "1997-09-25",
  guestName: null,
  showType: "coast",
  duration: 10_800,
  sourceUrl: null,
  kind: "on-this-date",
  start: 0,
  end: 10_800_000,
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  controller.tuneIn.mockClear();
  useRadioDialStore.setState({ position: 0, scanning: null });
  useLiveStore.setState({ tuned: false });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useRadioDialStore.getState().stopScan();
});

describe("airDateDayIndex", () => {
  it("counts whole local days from the earliest station", () => {
    expect(airDateDayIndex("1988-01-01", EARLIEST)).toBe(0);
    expect(airDateDayIndex("1988-01-31", EARLIEST)).toBe(30);
    // Across a DST change the local-midnight difference is 23 h or 25 h; the
    // index is still a whole number of days.
    expect(airDateDayIndex("1988-12-31", EARLIEST)).toBe(365);
    expect(airDateDayIndex(null, EARLIEST)).toBeNull();
    expect(airDateDayIndex("not a date", EARLIEST)).toBeNull();
  });
});

describe("LiveDialLamp", () => {
  it("renders nothing when nothing is on the air", () => {
    act(() => root.render(<LiveDialLamp slot={null} earliest={EARLIEST} />));
    expect(host.querySelector('[data-testid="dial-on-air"]')).toBeNull();
  });

  it("names the show; a tap tunes in and moves the needle to its day", () => {
    const onDial = vi.fn();
    act(() =>
      root.render(
        <div onClick={onDial}>
          <LiveDialLamp slot={SLOT} earliest={EARLIEST} />
        </div>,
      ),
    );
    const lamp = host.querySelector<HTMLButtonElement>('[data-testid="dial-on-air"]')!;
    expect(lamp.textContent).toContain(SLOT.title);
    expect(lamp.querySelector('[data-on-air="lit"]')).not.toBeNull();

    act(() => lamp.click());
    expect(controller.tuneIn).toHaveBeenCalledTimes(1);
    expect(useRadioDialStore.getState().position).toBe(airDateDayIndex(SLOT.airDate, EARLIEST));
    expect(useRadioDialStore.getState().position).toBeGreaterThan(3000);
    // The tap is the station's: the dial's own click handler does not see it.
    expect(onDial).not.toHaveBeenCalled();
  });

  it("says so once tuned in", () => {
    useLiveStore.setState({ tuned: true });
    act(() => root.render(<LiveDialLamp slot={SLOT} earliest={EARLIEST} />));
    const lamp = host.querySelector('[data-testid="dial-on-air"]')!;
    expect(lamp.textContent).toContain("Tuned in live");
    expect(lamp.querySelector("[data-tuned]")).not.toBeNull();
  });
});
