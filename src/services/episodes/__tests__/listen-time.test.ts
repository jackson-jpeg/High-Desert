import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";

/**
 * Listened time is the media time that passed, bounded by the wall clock
 * (UI plan push 6, batch 2). Real Dexie over fake-indexeddb.
 */

const { db } = await import("@/db");
const {
  noteListenTick,
  breakListenTick,
  flushListenSeconds,
  pendingListenSeconds,
  resetListenTimeForTests,
} = await import("../listen-time");

/** The wall clock the ticks run on, in ms. */
let wall = 0;
/** One tick, `media` seconds into the show, `wallStepMs` after the last. */
function tick(media: number, wallStepMs = 250, rate = 1) {
  wall += wallStepMs;
  noteListenTick(media, wall, rate);
}
/** Play from `from` for `seconds` at 250 ms ticks; returns where it ended. */
function play(from: number, seconds: number): number {
  noteListenTick(from, (wall += 250));
  let t = from;
  while (t < from + seconds - 1e-9) {
    t += 0.25;
    tick(t);
  }
  return t;
}

const show = (id: number) => ({ id, title: `Show ${id}`, fileName: `${id}.mp3`, guestName: "Al Bielek" });

beforeEach(async () => {
  resetListenTimeForTests();
  wall = 0;
  await db.delete();
  await db.open();
});

describe("counting", () => {
  it("counts continuous playback", () => {
    play(0, 60);
    expect(pendingListenSeconds()).toBeCloseTo(60, 6);
  });

  it("a locked phone: no ticks for an hour, then the page wakes an hour further on, and the hour counts", () => {
    // iOS suspends the page with the screen off; the first tick after it
    // sees the whole hour at once. This read 0 s before 2026-11-27.
    const at = play(0, 10);
    tick(at + 3_600, 3_600_000);
    play(at + 3_600, 10);
    expect(pendingListenSeconds()).toBeCloseTo(3_620, 6);
  });

  it("a hidden tab throttled to one tick a minute still counts every minute", () => {
    let t = play(0, 1);
    for (let i = 0; i < 30; i++) tick((t += 60), 60_000);
    expect(pendingListenSeconds()).toBeCloseTo(1 + 30 * 60, 6);
  });

  it("a seek forward is not listening, even a short one", () => {
    play(0, 10);
    tick(7_200); // two hours in, a quarter second later
    const at = play(7_200, 10);
    tick(at + 15); // fifteen seconds on, a quarter second later
    expect(pendingListenSeconds()).toBeCloseTo(20, 6);
  });

  it("a seek forward while the page slept counts no more than the time that passed", () => {
    const at = play(0, 10);
    tick(at + 3 * 3_600, 600_000); // ten minutes asleep, three hours further
    expect(pendingListenSeconds()).toBeCloseTo(10, 6);
  });

  it("a jump back is not negative listening", () => {
    play(100, 10);
    play(0, 10);
    expect(pendingListenSeconds()).toBeCloseTo(20, 6);
  });

  it("at 2x the show runs twice as fast as the clock, and counts", () => {
    noteListenTick(0, (wall += 250), 2);
    for (let t = 0.5; t <= 60 + 1e-9; t += 0.5) tick(t, 250, 2);
    expect(pendingListenSeconds()).toBeCloseTo(60, 6);
  });

  it("after a pause the first tick is a baseline, even if the position moved", () => {
    play(0, 5);
    breakListenTick();
    tick(6); // a seek while paused
    expect(pendingListenSeconds()).toBeCloseTo(5, 6);
  });
});

describe("flushing into history (the only writer of a history row)", () => {
  it("adds to the newest row when it is this show today, and leaves the others alone", async () => {
    const today = Date.now();
    await db.history.bulkAdd([
      { episodeId: 1, timestamp: today - 3_000, duration: 50 },
      { episodeId: 2, timestamp: today - 2_000, duration: 0 },
      { episodeId: 1, timestamp: today - 1_000, duration: 0 },
    ]);
    play(0, 30);
    await flushListenSeconds(show(1));
    const rows = await db.history.orderBy("timestamp").toArray();
    expect(rows.map((r) => Math.round(r.duration))).toEqual([50, 0, 30]);
    expect(pendingListenSeconds()).toBe(0);
  });

  it("another show in between makes a new row with the show's title and guest", async () => {
    await db.history.add({ episodeId: 2, timestamp: Date.now() - 1_000, duration: 120 });
    play(0, 90);
    await flushListenSeconds(show(1));
    const rows = await db.history.orderBy("timestamp").toArray();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ episodeId: 1, episodeTitle: "Show 1", guestName: "Al Bielek" });
    expect(Math.round(rows[1].duration)).toBe(90);
  });

  it("nothing heard writes nothing: a show restored on a page load is not a listen", async () => {
    await flushListenSeconds(show(1));
    expect(await db.history.count()).toBe(0);
  });

  it("with no episode, keeps the seconds for the next flush", async () => {
    play(0, 8);
    await flushListenSeconds(undefined);
    expect(pendingListenSeconds()).toBeCloseTo(8, 6);
  });
});
