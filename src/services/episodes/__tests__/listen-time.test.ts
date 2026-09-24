import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";

/**
 * Listened time is measured from the position tick, not read off
 * `playbackPosition` (Part 1D). Real Dexie over fake-indexeddb.
 */

const { db } = await import("@/db");
const {
  noteListenTick,
  breakListenTick,
  flushListenSeconds,
  pendingListenSeconds,
  resetListenTimeForTests,
  MAX_TICK_S,
} = await import("../listen-time");

/** Play from `from` for `seconds` at 250 ms ticks. */
function play(from: number, seconds: number) {
  for (let t = from; t <= from + seconds + 1e-9; t += 0.25) noteListenTick(t);
}

beforeEach(async () => {
  resetListenTimeForTests();
  await db.delete();
  await db.open();
});

describe("counting", () => {
  it("counts continuous playback", () => {
    play(0, 60);
    expect(pendingListenSeconds()).toBeCloseTo(60, 6);
  });

  it("a seek forward is not listening", () => {
    play(0, 10);
    noteListenTick(7_200); // jumped two hours in
    play(7_200, 10);
    expect(pendingListenSeconds()).toBeCloseTo(20, 6);
  });

  it("a jump back is not negative listening", () => {
    play(100, 10);
    play(0, 10);
    expect(pendingListenSeconds()).toBeCloseTo(20, 6);
  });

  it(`steps up to ${MAX_TICK_S}s count (2× speed on a busy thread), longer ones do not`, () => {
    noteListenTick(0);
    noteListenTick(MAX_TICK_S);
    noteListenTick(MAX_TICK_S * 2 + 0.01);
    expect(pendingListenSeconds()).toBe(MAX_TICK_S);
  });

  it("after a pause the first tick is a baseline, even if the position moved", () => {
    play(0, 5);
    breakListenTick();
    noteListenTick(6); // a seek while paused, by less than MAX_TICK_S
    expect(pendingListenSeconds()).toBeCloseTo(5, 6);
  });
});

describe("flushing into history", () => {
  it("adds to the episode's newest history row and leaves the others alone", async () => {
    await db.history.bulkAdd([
      { episodeId: 1, timestamp: 100, duration: 50 },
      { episodeId: 1, timestamp: 200, duration: 0 },
      { episodeId: 2, timestamp: 300, duration: 0 },
    ]);
    play(0, 30);
    await flushListenSeconds(1);
    const rows = await db.history.orderBy("timestamp").toArray();
    expect(rows.map((r) => Math.round(r.duration))).toEqual([50, 30, 0]);
    expect(pendingListenSeconds()).toBe(0);

    play(30, 30);
    await flushListenSeconds(1);
    expect(Math.round((await db.history.orderBy("timestamp").toArray())[1].duration)).toBe(60);
  });

  it("creates a row if the layout's insert has not landed yet", async () => {
    play(0, 12);
    await flushListenSeconds(9);
    const rows = await db.history.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].episodeId).toBe(9);
    expect(Math.round(rows[0].duration)).toBe(12);
  });

  it("with no episode, keeps the seconds for the next flush", async () => {
    play(0, 8);
    await flushListenSeconds(undefined);
    expect(pendingListenSeconds()).toBeCloseTo(8, 6);
  });
});
