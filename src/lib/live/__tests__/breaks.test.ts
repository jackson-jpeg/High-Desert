import { describe, it, expect } from "vitest";
import {
  applyBreaks,
  breakInGap,
  BREAK_PAD_SEC,
  BREAKS_FROM_MS,
  MIN_KEEP_MS,
  planFor,
  WEEK,
  weekday,
  type SpotAudio,
} from "@/lib/live/breaks";
import { STATION_ID_SEC, type DayProgram, type ProgramSlot } from "@/lib/live/schedule";
import { addDays, pacificDayBounds, requestStartAt } from "@/lib/live/pacific";

/** Station Breaks' placement (docs/station-breaks.md). */

const GAP = STATION_ID_SEC * 1000;
const AUDIO: Record<string, SpotAudio> = {
  sogojet: { id: "sogojet", cart: "07", durationSec: 18, url: "/audio/breaks/sogojet.mp3" },
  screenreceipts: { id: "screenreceipts", cart: "12", durationSec: 17.5, url: "/audio/breaks/screenreceipts.mp3" },
  simsunday: { id: "simsunday", cart: "21", durationSec: 19.5, url: "/audio/breaks/simsunday.mp3" },
};
const lenMs = (id: string) => Math.round((AUDIO[id].durationSec + BREAK_PAD_SEC) * 1000);

let n = 0;
function slot(start: number, minutes: number, cutTo?: number): ProgramSlot {
  n += 1;
  return {
    fileHash: `archive:c:s${n}.mp3`,
    episodeId: `c--s${n}`,
    title: `Show ${n}`,
    airDate: null,
    guestName: null,
    showType: "coast",
    duration: minutes * 60,
    sourceUrl: null,
    kind: "fan-favorite",
    start,
    end: cutTo ?? start + minutes * 60_000,
  };
}

/**
 * A day laid out like buildDay: end to end with the station ID between, the
 * last show before 10 PM ending `slackMin` minutes before it (or cut to end a
 * station ID before it when `cut`), the stand-in on the hour at 10 PM, and
 * the night after it cut at midnight.
 */
function day(d: string, lengths: number[], opts: { slackMin?: number; cut?: boolean } = {}): DayProgram {
  const { start, end } = pacificDayBounds(d);
  const ten = requestStartAt(d);
  const slots: ProgramSlot[] = [];
  let t = start;
  for (const m of lengths) {
    slots.push(slot(t, m));
    t += m * 60_000 + GAP;
  }
  // the last pre-10 PM show: fills to 10 PM minus slack, or is cut there
  const room = ten - GAP - t;
  if (opts.cut) slots.push(slot(t, room / 60_000 + 40, ten - GAP));
  else slots.push(slot(t, (room - (opts.slackMin ?? 4) * 60_000) / 60_000));
  const req = slot(ten, 150, end);
  req.requestSlot = true;
  slots.push(req);
  return { day: d, start, end, slots, ranking: [] };
}

// A Monday (late Screen Receipts with a card, evening SoGoJet) after BREAKS_FROM.
const MON = "2026-11-16";
// Shows of 2 h 50 m from midnight: boundaries near 8 PM at about 5:57 PM and 8:48 PM.
const LENGTHS = [170, 170, 170, 170, 170, 170, 170];

describe("the week", () => {
  it("airs one or two spots a day, five cards a week, SoGoJet most, Sim Sunday once, on Sunday", () => {
    const spots = WEEK.flatMap((w) => [w.evening, ...(w.late ? [w.late] : [])]);
    expect(spots.length).toBe(11);
    expect(spots.filter((s) => s.card).length).toBe(5);
    const count = (id: string) => spots.filter((s) => s.spot === id).length;
    expect(count("sogojet")).toBeGreaterThan(count("screenreceipts"));
    expect(count("screenreceipts")).toBeGreaterThan(count("simsunday"));
    expect(count("simsunday")).toBe(1);
    expect(WEEK[0].evening.spot).toBe("simsunday");
    // Screen Receipts only ever late.
    expect(WEEK.every((w) => w.evening.spot !== "screenreceipts")).toBe(true);
    for (const w of WEEK) expect(1 + (w.late ? 1 : 0)).toBeLessThanOrEqual(2);
  });

  it("knows the Pacific day's weekday", () => {
    expect(weekday("2026-11-15")).toBe(0);
    expect(weekday(MON)).toBe(1);
    expect(planFor(MON).map((p) => [p.slot, p.entry.spot])).toEqual([
      ["late", "screenreceipts"],
      ["evening", "sogojet"],
    ]);
  });
});

describe("applyBreaks", () => {
  it("puts the late break at midnight and the evening one at the boundary nearest 8 PM", () => {
    const p = day(MON, LENGTHS, { slackMin: 4 });
    const { breaks } = applyBreaks(p, AUDIO);
    expect(breaks.map((b) => [b.slot, b.spot, b.card])).toEqual([
      ["late", "screenreceipts", true],
      ["evening", "sogojet", false],
    ]);
    expect(breaks[0].start).toBe(p.start);
    const eight = p.end - 4 * 3_600_000;
    const boundaries = p.slots.slice(1).map((s) => s.start);
    const nearest = boundaries.reduce((a, b) => (Math.abs(b - eight) < Math.abs(a - eight) ? b : a));
    const evening = breaks[1];
    // It starts where a show ended, and that show's successor was nearest 8 PM.
    expect(Math.abs(evening.start - eight)).toBeLessThan(Math.abs(nearest - eight) + 2 * 60_000);
    expect(evening.end - evening.start).toBe(Math.round(AUDIO.sogojet.durationSec * 1000));
    expect(evening.id).toBe(`${MON}:evening`);
  });

  it("never starts a show before its break, the station ID and the pad are over", () => {
    const p = day(MON, LENGTHS, { slackMin: 4 });
    const { program, breaks } = applyBreaks(p, AUDIO);
    for (const b of breaks) {
      const next = program.slots.find((s) => s.start >= b.start)!;
      expect(next.start - b.start).toBeGreaterThanOrEqual(lenMs(b.spot) + GAP);
      const prev = [...program.slots].reverse().find((s) => s.start < b.start);
      if (prev) expect(prev.end).toBeLessThanOrEqual(b.start);
    }
  });

  it("never moves the 10 PM slot, and shortens no show that plays in full", () => {
    const p = day(MON, LENGTHS, { slackMin: 4 });
    const { program } = applyBreaks(p, AUDIO);
    const ten = requestStartAt(MON);
    expect(program.slots.find((s) => s.requestSlot)!.start).toBe(ten);
    for (const s of program.slots) {
      const was = p.slots.find((x) => x.fileHash === s.fileHash)!;
      expect(s.end - s.start).toBe(was.end - was.start);
    }
    // The slack before 10 PM took the shift.
    expect(program.slots.every((s) => s.start >= ten || s.end + GAP <= ten)).toBe(true);
  });

  it("with no slack before 10 PM, trims only the show the day already cut, and keeps 10 PM", () => {
    const p = day(MON, LENGTHS, { cut: true });
    const { program, breaks } = applyBreaks(p, AUDIO);
    expect(breaks.length).toBe(2);
    const ten = requestStartAt(MON);
    const cutBefore = p.slots[p.slots.length - 2];
    const cutAfter = program.slots.find((s) => s.fileHash === cutBefore.fileHash)!;
    expect(cutAfter.end).toBe(ten - GAP);
    // Midnight's break brings its own station ID (the day's first show had none before it).
    expect(cutBefore.end - cutBefore.start - (cutAfter.end - cutAfter.start)).toBe(lenMs("screenreceipts") + GAP + lenMs("sogojet"));
    expect(program.slots.find((s) => s.requestSlot)!.start).toBe(ten);
    for (const s of program.slots.slice(0, -2)) {
      const was = p.slots.find((x) => x.fileHash === s.fileHash)!;
      expect(s.end - s.start).toBe(was.end - was.start);
    }
  });

  it("skips a break that does not fit rather than cut into a show playing in full", () => {
    const p = day(MON, LENGTHS, { slackMin: 0.2 });
    const { program, breaks } = applyBreaks(p, AUDIO);
    expect(breaks).toEqual([]);
    expect(program).toBe(p);
  });

  it("puts nothing before BREAKS_FROM_MS (the day they shipped keeps its morning)", () => {
    const d = "2026-11-09";
    expect(pacificDayBounds(d).start).toBeLessThan(BREAKS_FROM_MS);
    const { breaks } = applyBreaks(day(d, LENGTHS, { slackMin: 4 }), AUDIO);
    expect(breaks.map((b) => b.slot)).toEqual(["evening"]);
    expect(breaks[0].start).toBeGreaterThanOrEqual(BREAKS_FROM_MS);
    expect(applyBreaks(day("2026-11-08", LENGTHS, { slackMin: 4 }), AUDIO).breaks).toEqual([]);
  });

  it("is deterministic in the day", () => {
    const p = day(MON, LENGTHS, { slackMin: 4 });
    expect(applyBreaks(p, AUDIO)).toEqual(applyBreaks(p, AUDIO));
  });

  it("a whole week of real-shaped days airs 11 spots and 5 cards", () => {
    let spots = 0;
    let cards = 0;
    for (let i = 0; i < 7; i++) {
      const { breaks } = applyBreaks(day(addDays(MON, i), LENGTHS, { slackMin: 4 }), AUDIO);
      spots += breaks.length;
      cards += breaks.filter((b) => b.card).length;
    }
    expect([spots, cards]).toEqual([11, 5]);
  });

  it("a missing spot file airs nothing for it", () => {
    const { breaks } = applyBreaks(day(MON, LENGTHS, { slackMin: 4 }), { sogojet: AUDIO.sogojet });
    expect(breaks.map((b) => b.spot)).toEqual(["sogojet"]);
  });
});

describe("breakInGap", () => {
  it("finds the unfinished break inside a gap, and none outside it", () => {
    const { breaks } = applyBreaks(day(MON, LENGTHS, { slackMin: 4 }), AUDIO);
    const b = breaks[1];
    expect(breakInGap(breaks, b.start, b.end + GAP)).toBe(b);
    expect(breakInGap(breaks, b.start - 5_000, b.start + 60_000)).toBe(b);
    expect(breakInGap(breaks, b.end, b.end + GAP)).toBeNull();
    expect(breakInGap(breaks, b.end + 60_000, b.end + 120_000)).toBeNull();
  });
});
