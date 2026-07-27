import { describe, it, expect } from "vitest";
import { computeStreak, dayKey } from "../streak";

const DAY = 86_400_000;
const NOW = new Date("2026-07-27T12:00:00");

/** A history entry `d` days before NOW. */
function entry(d: number) {
  return { timestamp: NOW.getTime() - d * DAY };
}

describe("dayKey", () => {
  it("formats local YYYY-MM-DD", () => {
    expect(dayKey(new Date(2026, 6, 27, 23, 30))).toBe("2026-07-27");
  });

  it("uses local time, not UTC, so late-evening listening counts as today", () => {
    // 11:30pm local on the 27th must not roll into the 28th
    expect(dayKey(new Date(2026, 6, 27, 23, 59))).toBe("2026-07-27");
    expect(dayKey(new Date(2026, 6, 28, 0, 1))).toBe("2026-07-28");
  });
});

describe("computeStreak", () => {
  it("returns 0 for no history", () => {
    expect(computeStreak([], NOW)).toBe(0);
    expect(computeStreak(undefined, NOW)).toBe(0);
    expect(computeStreak(null, NOW)).toBe(0);
  });

  it("counts a single day listened today", () => {
    expect(computeStreak([entry(0)], NOW)).toBe(1);
  });

  it("counts consecutive days", () => {
    expect(computeStreak([entry(0), entry(1), entry(2)], NOW)).toBe(3);
  });

  it("does not break when today has no entry yet", () => {
    // Listened yesterday and the day before, but not yet today
    expect(computeStreak([entry(1), entry(2)], NOW)).toBe(2);
  });

  it("breaks on a fully missed day", () => {
    // today, yesterday, then a gap at day 2
    expect(computeStreak([entry(0), entry(1), entry(3), entry(4)], NOW)).toBe(2);
  });

  it("returns 0 when the most recent listen is older than yesterday", () => {
    expect(computeStreak([entry(3), entry(4)], NOW)).toBe(0);
  });

  it("deduplicates multiple entries on the same day", () => {
    expect(computeStreak([entry(0), entry(0), entry(0), entry(1)], NOW)).toBe(2);
  });

  it("is not confused by unordered input", () => {
    expect(computeStreak([entry(2), entry(0), entry(1)], NOW)).toBe(3);
  });

  it("caps at a year rather than looping forever", () => {
    const everyDay = Array.from({ length: 500 }, (_, i) => entry(i));
    expect(computeStreak(everyDay, NOW)).toBe(365);
  });
});
