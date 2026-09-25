import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `deduplicateEpisodes()` and the `progress` table (HD-016), against a real
 * (fake-indexeddb) database. Merging two copies of an episode must carry the
 * most recently played copy's position onto the keeper's hash, drop the retired
 * copy's entry, and leave every other episode's progress exactly as it was.
 */

vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));

const { db } = await import("../index");
const { deduplicateEpisodes } = await import("../deduplicate");

const KEEP = "archive:coll:a.mp3";
const RETIRE = "archive:coll";

beforeEach(async () => {
  await Promise.all([db.episodes.clear(), db.progress.clear(), db.history.clear(), db.bookmarks.clear(), db.playlists.clear(), db.userPrefs.clear()]);
});

describe("deduplicateEpisodes — progress (HD-016)", () => {
  it("moves the later-played copy's position onto the keeper's hash and drops the retired entry", async () => {
    const base = { filePath: "", fileSize: 0, source: "archive", createdAt: 0, updatedAt: 0 };
    await db.episodes.bulkAdd([
      { ...base, fileHash: KEEP, archiveIdentifier: "coll", fileName: "a.mp3", title: "A", airDate: "1997-01-01" },
      { ...base, fileHash: RETIRE, archiveIdentifier: "coll", fileName: "a.mp3" },
      // Bystanders: enough rows that one removal stays under the delete-ratio rail.
      ...[1, 2, 3, 4, 5].map((n) => ({ ...base, fileHash: `archive:coll:${n}.mp3`, archiveIdentifier: "coll", fileName: `${n}.mp3`, title: `S${n}` })),
    ] as never);
    await db.progress.bulkPut([
      { fileHash: KEEP, playbackPosition: 100, lastPlayedAt: 10 },
      { fileHash: RETIRE, playbackPosition: 900, lastPlayedAt: 20 },
      { fileHash: "archive:coll:3.mp3", playbackPosition: 42, lastPlayedAt: 5 },
    ]);

    const result = await deduplicateEpisodes();
    expect(result.aborted).toBeFalsy();
    expect(result.duplicatesRemoved).toBe(1);

    expect(await db.episodes.where("fileHash").equals(RETIRE).count()).toBe(0);
    expect(await db.progress.get(KEEP)).toEqual({ fileHash: KEEP, playbackPosition: 900, lastPlayedAt: 20 });
    expect(await db.progress.get(RETIRE)).toBeUndefined();
    // A bystander's progress survives untouched.
    expect(await db.progress.get("archive:coll:3.mp3")).toEqual({ fileHash: "archive:coll:3.mp3", playbackPosition: 42, lastPlayedAt: 5 });
    expect(await db.progress.count()).toBe(2);
  });
});
