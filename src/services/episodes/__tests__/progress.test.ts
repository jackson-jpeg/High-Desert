import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The progress service (HD-016) against a real (fake-indexeddb) database:
 * writes land in `db.progress` and in the in-memory store, the sync mirrors
 * the table, and "recently played" orders by the progress index and joins to
 * episode rows by fileHash.
 */

const { db } = await import("@/db");
const { writeProgress, startProgressSync, progressReady, recentlyPlayedEpisodes, resetProgressSyncForTests } =
  await import("../progress");
const { useProgressStore, positionOf } = await import("@/stores/progress-store");

const H = (n: number) => `archive:coll:${n}.mp3`;

async function addEpisode(n: number) {
  return db.episodes.add({
    fileHash: H(n),
    fileName: `${n}.mp3`,
    title: `Show ${n}`,
    source: "archive",
    createdAt: 0,
    updatedAt: 0,
  } as never);
}

describe("progress service (HD-016)", () => {
  beforeEach(async () => {
    resetProgressSyncForTests();
    useProgressStore.getState().reset();
    await db.episodes.clear();
    await db.progress.clear();
  });

  it("writeProgress merges into the table and the store, and never touches db.episodes", async () => {
    const id = await addEpisode(1);
    const before = await db.episodes.get(id);
    await writeProgress(H(1), { lastPlayedAt: 5 });
    await writeProgress(H(1), { playbackPosition: 120 });
    expect(await db.progress.get(H(1))).toEqual({ fileHash: H(1), lastPlayedAt: 5, playbackPosition: 120 });
    expect(positionOf(H(1))).toBe(120);
    expect(await db.episodes.get(id)).toEqual(before);
  });

  it("the sync fills the store from the table and follows later writes", async () => {
    await db.progress.put({ fileHash: H(2), playbackPosition: 50 });
    const stop = startProgressSync();
    await progressReady();
    expect(positionOf(H(2))).toBe(50);
    // A write that bypasses the store (another tab) still arrives.
    await db.progress.put({ fileHash: H(2), playbackPosition: 75 });
    await expect.poll(() => positionOf(H(2))).toBe(75);
    stop();
  });

  it("recentlyPlayedEpisodes orders by lastPlayedAt, skips orphans, and honours the limit", async () => {
    await addEpisode(1);
    await addEpisode(2);
    await addEpisode(3);
    await db.progress.bulkPut([
      { fileHash: H(1), lastPlayedAt: 100 },
      { fileHash: H(2), lastPlayedAt: 300 },
      { fileHash: H(3), playbackPosition: 10 }, // positioned, never counted as played
      { fileHash: H(9), lastPlayedAt: 999 }, // no episode row
    ]);
    const all = await recentlyPlayedEpisodes();
    expect(all.map((p) => p.episode.fileHash)).toEqual([H(2), H(1)]);
    expect(all[0].progress.lastPlayedAt).toBe(300);
    const one = await recentlyPlayedEpisodes(1);
    expect(one.map((p) => p.episode.fileHash)).toEqual([H(2)]);
  });
});
