import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Listening History repeats (2026-10-31). Restoring the remembered show on a
 * page load changed the player's episode id (none → id), and the layout added
 * a history row on every change: one listen of Philadelphia Experiment read as
 * six rows on /stats. Real Dexie, asserting on the stored rows.
 */

const { db } = await import("@/db");
const { recordHistory, foldRepeats } = await import("../history");

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

describe("recordHistory", () => {
  it("the same show again on the same day (a reload, a revisit) adds no row", async () => {
    const ep = await episode("Philadelphia Experiment");
    await recordHistory(ep as never, noon);
    await recordHistory(ep as never, noon + 2 * 60 * 60_000);
    await recordHistory(ep as never, noon + 3 * 60 * 60_000);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ episodeId: ep.id, timestamp: noon, episodeTitle: "Philadelphia Experiment", guestName: "Al Bielek" });
  });

  // The control: without it, "one row" would pass for a writer that never writes twice.
  it("another show is a new row, and going back to the first is one more", async () => {
    const a = await episode("Philadelphia Experiment");
    const b = await episode("Area 51");
    await recordHistory(a as never, noon);
    await recordHistory(b as never, noon + 60_000);
    await recordHistory(a as never, noon + 120_000);
    expect((await rows()).map((r) => r.episodeId)).toEqual([a.id, b.id, a.id]);
  });

  it("the same show on a later day is a new row", async () => {
    const ep = await episode("Philadelphia Experiment");
    await recordHistory(ep as never, noon);
    await recordHistory(ep as never, noon + DAY);
    expect(await rows()).toHaveLength(2);
  });

  it("the layout writes history only through it", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/[look]/(desktop)/layout.tsx"), "utf8");
    expect(layout).toContain("recordHistory(state.currentEpisode)");
    expect(layout).not.toContain("db.history.add");
  });
});

describe("foldRepeats: rows already saved before the fix", () => {
  const row = (episodeId: number, at: number) => ({ episodeId, timestamp: at });

  it("back-to-back rows of one show on one day are shown once, the newest", () => {
    const newestFirst = [row(1, noon + 5_000), row(1, noon + 4_000), row(1, noon + 3_000), row(2, noon + 2_000), row(1, noon + 1_000)];
    expect(foldRepeats(newestFirst)).toEqual([row(1, noon + 5_000), row(2, noon + 2_000), row(1, noon + 1_000)]);
  });

  it("the same show on two days stays two rows", () => {
    expect(foldRepeats([row(1, noon + DAY), row(1, noon)])).toHaveLength(2);
  });
});
