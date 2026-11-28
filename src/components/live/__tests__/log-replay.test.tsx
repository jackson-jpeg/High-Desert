import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProgramGuide, replayLabel } from "../ProgramGuide";
import { archiveHeading } from "../LiveChat";
import { archiveLabel } from "@/components/looks/win98/notepad-log";
import { isStationNotice, type ArchiveLine } from "@/services/live/client";
import type { ProgramSlot } from "@/lib/live/schedule";

/**
 * "Missed it?" (2026-11-28). On 2026-11-23 a listener wrote in the phone
 * lines that they wished they had caught Harlot with everyone, and another
 * went to YouTube for it: Tonight's log named the show and offered no way to
 * hear it. A show that has aired now has Play from the start; one on the air
 * or still to come has nothing (the station plays those, at the same second
 * for everyone).
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 28, 8);
const slots: ProgramSlot[] = ["Harlot", "Area 51", "Time Travel"].map((title, i) => ({
  fileHash: `archive:x:${i}.mp3`,
  episodeId: `e${i}`,
  title: `Coast to Coast AM - ${title}`,
  airDate: "1997-09-25",
  guestName: null,
  showType: "coast",
  duration: 3 * HOUR / 1000,
  sourceUrl: `https://archive.org/download/x/${i}.mp3`,
  kind: "fan-favorite",
  start: T0 + i * 3 * HOUR,
  end: T0 + (i + 1) * 3 * HOUR,
}));
const NOW = slots[1].start + 60_000; // the first has aired, the second is on, the third is to come

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(props: { marker?: boolean; onReplay?: (s: ProgramSlot) => void }) {
  act(() => root.render(createElement(ProgramGuide, { slots, now: NOW, ...props })));
  return [...host.querySelectorAll<HTMLButtonElement>("[data-testid=live-guide-replay]")];
}

describe("Tonight's log: a show that has aired can be heard from the start", () => {
  it("only the aired show has the button, named for its show", () => {
    const buttons = render({ onReplay: () => {} });
    expect(buttons).toHaveLength(1);
    const row = buttons[0].closest("li")!;
    expect(row.getAttribute("data-state")).toBe("past");
    expect(buttons[0].getAttribute("aria-label")).toBe(replayLabel(slots[0]));
    expect(buttons[0].textContent).toContain("Play from the start");
  });

  it("the tap hands over that slot, and only that slot", () => {
    const onReplay = vi.fn();
    const [b] = render({ onReplay });
    act(() => b.click());
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(onReplay.mock.calls[0][0]).toBe(slots[0]);
  });

  it("on a phone too (the on-air row is a marker, the aired one keeps its button)", () => {
    const buttons = render({ marker: true, onReplay: () => {} });
    expect(buttons).toHaveLength(1);
    expect(host.querySelector("[data-testid=live-guide-now]")).not.toBeNull();
  });

  it("every aired show gets one once the evening is over", () => {
    act(() => root.render(createElement(ProgramGuide, { slots, now: slots[2].end + 1, onReplay: () => {} })));
    expect(host.querySelectorAll("[data-testid=live-guide-replay]")).toHaveLength(3);
  });

  it("without a handler the log stays read-only", () => {
    expect(render({})).toHaveLength(0);
  });

  it("its words carry no em dash", () => {
    const [b] = render({ onReplay: () => {} });
    expect(b.textContent).not.toContain("—");
    expect(b.getAttribute("aria-label")).not.toContain("—");
  });
});

describe("the Request Line's herald is the station talking, not the archive", () => {
  const line = (reason: string): ArchiveLine => ({
    id: "x",
    at: "2026-11-28T04:00:00Z",
    text: "Tonight's request, from Late-Shift Skywatcher.",
    form: "moment",
    speaker: null,
    episode: null,
    reason,
  });

  it("a herald (reason request) is headed From the station in both looks", () => {
    expect(isStationNotice(line("request"))).toBe(true);
    expect(archiveHeading(line("request"))).toBe("From the station");
    expect(archiveLabel(line("request"))).toBe(">>> From the station");
  });

  it("an admin's notice still is, and an archive moment still is not", () => {
    expect(archiveHeading(line("station"))).toBe("From the station");
    expect(archiveHeading(line("archive"))).toBe("From the archive");
    expect(archiveHeading(line("on-air"))).toBe("From the archive: this show");
    expect(isStationNotice(line("topic"))).toBe(false);
  });
});
