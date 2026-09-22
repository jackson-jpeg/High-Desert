import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * "Clear Library" (HD-025). It used to clear `episodes` and `scanSessions`
 * only, orphaning history, bookmarks, playlists and the saved queue. Now one
 * transaction clears everything that points into the library — and nothing
 * else, and nothing at all if any part of it fails.
 */

vi.mock("@/audio/cache", () => ({
  removeCachedAudio: () => Promise.resolve(),
  isOPFSSupported: () => false,
}));
vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));

const { db } = await import("@/db");
const { clearLibrary } = await import("../management");

async function prefs(): Promise<Record<string, string>> {
  return Object.fromEntries((await db.userPrefs.toArray()).map((p) => [p.key, p.value]));
}

async function fill() {
  const a = (await db.episodes.add({
    fileHash: "archive:coll:a.mp3", filePath: "", fileName: "a.mp3", fileSize: 0,
    favoritedAt: 1, createdAt: 0, updatedAt: 0,
  })) as number;
  await db.scanSessions.add({ startedAt: 0, rootPath: "/", totalFiles: 1, processedFiles: 1, newEpisodes: 1, duplicates: 0, errors: 0, status: "completed" });
  await db.history.add({ episodeId: a, timestamp: 1, duration: 1 });
  await db.bookmarks.add({ episodeId: a, position: 1, label: "x", createdAt: 1 });
  await db.playlists.add({ name: "p", episodeIds: [a], createdAt: 0, updatedAt: 0 });
  await db.userPrefs.bulkAdd([
    { key: "queue-ids", value: JSON.stringify([a]) },
    { key: "queue-index", value: "0" },
    { key: "last-episode-id", value: String(a) },
    { key: "deleted-hashes", value: JSON.stringify(["archive:coll:gone.mp3"]) },
    { key: "seed-reconciled", value: "2026-07-27-a" },
    { key: "volume", value: "0.5" },
    { key: "text-scale", value: "large" },
  ]);
}

async function counts() {
  return {
    episodes: await db.episodes.count(),
    scanSessions: await db.scanSessions.count(),
    history: await db.history.count(),
    bookmarks: await db.bookmarks.count(),
    playlists: await db.playlists.count(),
  };
}

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("clearLibrary", () => {
  it("clears every table that points into the library, and resets the seed markers", async () => {
    await fill();
    await clearLibrary();

    expect(await counts()).toEqual({ episodes: 0, scanSessions: 0, history: 0, bookmarks: 0, playlists: 0 });
    const p = await prefs();
    expect(p["queue-ids"]).toBeUndefined();
    expect(p["queue-index"]).toBeUndefined();
    expect(p["last-episode-id"]).toBeUndefined();
    expect(p["deleted-hashes"]).toBe("[]");
    expect(p["seed-reconciled"]).toBe("");
  });

  it("keeps the preferences that are not about the library", async () => {
    await fill();
    await clearLibrary();
    const p = await prefs();
    expect(p.volume).toBe("0.5");
    expect(p["text-scale"]).toBe("large");
  });

  it("a failure part-way through leaves everything exactly as it was", async () => {
    await fill();
    const before = { counts: await counts(), prefs: await prefs() };

    // Playlists are cleared after episodes, sessions, history and bookmarks.
    const spy = vi.spyOn(db.playlists, "clear").mockImplementationOnce(() => {
      throw new Error("injected mid-clear failure");
    });
    try {
      await expect(clearLibrary()).rejects.toThrow("injected mid-clear failure");
    } finally {
      spy.mockRestore();
    }

    expect(await counts()).toEqual(before.counts);
    expect(await prefs()).toEqual(before.prefs);
    expect((await db.episodes.toArray())[0]).toMatchObject({ favoritedAt: 1 });
  });
});
