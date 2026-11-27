import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Listening History repeats (2026-10-31, then 2026-11-27). Restoring the
 * remembered show on a page load changed the player's episode id (none → id),
 * and the layout added a history row on every change: one listen of
 * Philadelphia Experiment read as six rows on /stats, then as one row a day
 * that nobody heard. Rows are now written by heard seconds only. Real Dexie,
 * asserting on the stored rows.
 */

const { db } = await import("@/db");
const { addListened, groupListens, realListens, LISTEN_MIN_S } = await import("../history");

const DAY = 24 * 60 * 60_000;
const noon = new Date(2026, 9, 31, 12, 0, 0).getTime();

async function episode(title: string): Promise<{ id: number; title: string; guestName: string; fileHash: string }> {
  const fileHash = `archive:hd:${title}.mp3`;
  const id = (await db.episodes.add({ title, guestName: "Al Bielek", fileHash, fileName: `${title}.mp3`, source: "archive" } as never)) as number;
  return { id, title, guestName: "Al Bielek", fileHash };
}

const rows = () => db.history.orderBy("timestamp").toArray();

beforeEach(async () => {
  await db.history.clear();
  await db.episodes.clear();
});

describe("addListened: a history row is seconds heard", () => {
  it("the same show again on the same day (a reload, a revisit) adds to its row", async () => {
    const ep = await episode("Philadelphia Experiment");
    await addListened(ep as never, 600, noon);
    await addListened(ep as never, 300, noon + 2 * 60 * 60_000);
    await addListened(ep as never, 300, noon + 3 * 60 * 60_000);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ episodeId: ep.id, timestamp: noon, duration: 1_200, episodeTitle: "Philadelphia Experiment", guestName: "Al Bielek" });
  });

  // The control: without it, "one row" would pass for a writer that never writes twice.
  it("another show is a new row, and going back to the first is one more", async () => {
    const a = await episode("Philadelphia Experiment");
    const b = await episode("Area 51");
    await addListened(a as never, 120, noon);
    await addListened(b as never, 120, noon + 60_000);
    await addListened(a as never, 120, noon + 120_000);
    expect((await rows()).map((r) => r.episodeId)).toEqual([a.id, b.id, a.id]);
  });

  it("the same show on a later day is a new row", async () => {
    const ep = await episode("Philadelphia Experiment");
    await addListened(ep as never, 120, noon);
    await addListened(ep as never, 120, noon + DAY);
    expect(await rows()).toHaveLength(2);
  });

  it("no seconds, no row", async () => {
    const ep = await episode("Philadelphia Experiment");
    await addListened(ep as never, 0, noon);
    expect(await rows()).toHaveLength(0);
  });

  it("the layout no longer writes history on a change of show (the restore on every page load)", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/[look]/(desktop)/layout.tsx"), "utf8");
    expect(layout).not.toMatch(/recordHistory|addListened|db\.history/);
  });
});

describe("real listens and the history's lines", () => {
  const row = (episodeId: number, at: number, duration: number) => ({ episodeId, timestamp: at, duration, episodeTitle: `Show ${episodeId}` });

  it("a row under a minute heard is not a listen; the 0 s rows page loads wrote drop out", () => {
    expect(LISTEN_MIN_S).toBe(60);
    expect(realListens([row(1, noon, 0), row(2, noon, 59), row(3, noon, 60)]).map((r) => r.episodeId)).toEqual([3]);
  });

  it("one line per show, newest first, with how many times it was played and the time heard", () => {
    const groups = groupListens([
      row(1, noon - 4 * DAY, 1_800),
      row(2, noon - 3 * DAY, 3_600),
      row(1, noon - 2 * DAY, 600),
      row(1, noon - DAY, 0), // a restore: not a play
      row(1, noon, 1_200),
    ] as never);
    expect(groups.map((g) => [g.episodeId, g.plays, g.seconds, g.last])).toEqual([
      [1, 3, 3_600, noon],
      [2, 1, 3_600, noon - 3 * DAY],
    ]);
  });
});

describe("the streak is real listens, everywhere", () => {
  it("days with only a restore or a half-minute do not count", async () => {
    const { listeningStreak } = await import("@/lib/stats/listens");
    const now = new Date(noon);
    const r = (daysAgo: number, duration: number) => ({ timestamp: noon - daysAgo * DAY, duration });
    expect(listeningStreak([r(1, 600), r(2, 600)], now)).toBe(2);
    expect(listeningStreak([r(0, 0), r(1, 600), r(2, 600), r(3, 30)], now)).toBe(2);
  });

  it("the status bar reads the same function as /stats", () => {
    const bar = readFileSync(path.join(process.cwd(), "src/components/desktop/StatusBar.tsx"), "utf8");
    expect(bar).toContain("listeningStreak(entries)");
    expect(bar).not.toContain("computeStreak(");
  });
});
