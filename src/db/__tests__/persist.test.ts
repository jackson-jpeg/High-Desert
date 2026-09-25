import "fake-indexeddb/auto";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * `navigator.storage.persist()` — asked once per profile, after the first
 * thing the listener actually does (HD-010).
 *
 * Driven through the real write functions against the real database, with the
 * observers installed the way production installs them: by importing `@/db`.
 * A test that called `requestPersistentStorage()` itself would pass with the
 * hooks never installed, which is the only way this can realistically break
 * (docs/disconnected-checks.md). So nothing here calls it.
 *
 * "Reload" is a genuine reload: the module graph is thrown away and `@/db`
 * re-imported, so the new instance knows only what is in IndexedDB.
 */

// Seeding the real 1,312-row catalog into fake-indexeddb, several times per
// file, does not fit vitest's 5s default on a loaded machine — and a test that
// times out mid-transaction leaves writes landing in the next test's profile,
// so the first failure spreads. The budget is the machine's, not the code's.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));
vi.mock("@/audio/cache", () => ({
  removeCachedAudio: () => Promise.resolve(),
  isOPFSSupported: () => false,
}));

const SEED = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../public/seed/library.json"), "utf8"),
) as Record<string, unknown>[];

const persist = vi.fn(() => Promise.resolve(true));
const persisted = vi.fn(() => Promise.resolve(false));

function stubStorage(value: unknown) {
  Object.defineProperty(navigator, "storage", { value, configurable: true });
}

type Loaded = {
  db: typeof import("@/db").db;
  management: typeof import("@/services/episodes/management");
  seed: typeof import("@/db/seed");
  progress: typeof import("@/services/episodes/progress");
};

let open: Loaded["db"][] = [];

/** A fresh page load: new module graph, new Dexie instance, same IndexedDB. */
async function load(): Promise<Loaded> {
  vi.resetModules();
  const { db } = await import("@/db");
  const management = await import("@/services/episodes/management");
  const seed = await import("@/db/seed");
  const progress = await import("@/services/episodes/progress");
  if (!db.isOpen()) await db.open();
  open.push(db);
  return { db, management, seed, progress };
}

/** Let the post-commit request (a `complete` callback, then a pref read) run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

function serveSeed(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)),
  );
}

beforeEach(async () => {
  stubStorage({ persist, persisted });
  const { db } = await load();
  await Promise.all([
    db.episodes.clear(), db.history.clear(), db.bookmarks.clear(),
    db.playlists.clear(), db.userPrefs.clear(), db.progress.clear(),
  ]);
  // Clearing playlists is itself a playlist write and asks; let that land,
  // then forget it, so each test starts from a profile that has never asked.
  await settle();
  await db.userPrefs.clear();
  persist.mockClear();
  persisted.mockClear();
  persisted.mockImplementation(() => Promise.resolve(false));
});

afterEach(() => {
  for (const db of open) db.close();
  open = [];
  vi.unstubAllGlobals();
});

async function seeded(): Promise<Loaded & { firstId: number; firstHash: string }> {
  const l = await load();
  serveSeed(SEED);
  expect(await l.seed.seedLibraryIfEmpty()).toBe(true);
  await settle();
  const first = await l.db.episodes.orderBy("id").first();
  return { ...l, firstId: first!.id!, firstHash: first!.fileHash };
}

describe("persist() is requested after the first real write", () => {
  it("is NOT requested by the seed — 1,312 rows written and nothing asked", async () => {
    const { db } = await seeded();
    expect(await db.episodes.count()).toBe(SEED.length);
    expect(persist).not.toHaveBeenCalled();
  });

  it("is not requested by a seed that restores playlists either", async () => {
    const l = await load();
    serveSeed({ version: 2, episodes: SEED.slice(0, 3), playlists: [{ name: "Shipped", episodeHashes: [SEED[0].fileHash] }] });
    await l.seed.seedLibraryIfEmpty();
    await settle();
    expect(await l.db.playlists.count()).toBe(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it("is requested exactly once after the first favourite", async () => {
    const { management, firstId, db } = await seeded();
    await management.toggleFavorite(firstId);
    await settle();
    expect(persist).toHaveBeenCalledTimes(1);
    // The favourite itself survived the hook.
    expect((await db.episodes.get(firstId))?.favoritedAt).toBeGreaterThan(0);
  });

  it("is not requested again by a second write, a different kind of write, or a reload", async () => {
    const { management, firstId, firstHash } = await seeded();
    await management.toggleFavorite(firstId);
    await settle();
    await management.rateEpisode(firstId, 4);
    await management.addBookmark(firstId, 60, "cold open");
    await settle();
    expect(persist).toHaveBeenCalledTimes(1);

    // Reload: a new instance has no memory of the request except the pref.
    const again = await load();
    await again.management.rateEpisode(firstId, 5);
    await again.progress.writeProgress(firstHash, { playbackPosition: 900 });
    await settle();
    expect(persist).toHaveBeenCalledTimes(1);
    expect((await again.db.episodes.get(firstId))?.rating).toBe(5);
  });

  it.each([
    ["a rating", (l: Loaded, id: number) => l.management.rateEpisode(id, 3)],
    ["a bookmark", (l: Loaded, id: number) => l.management.addBookmark(id, 12, "here")],
    // The player's own writer, into the `progress` table (HD-016).
    ["a saved playback position", (l: Loaded & { firstHash: string }) => l.progress.writeProgress(l.firstHash, { playbackPosition: 321, lastPlayedAt: Date.now() })],
    ["a new playlist", (l: Loaded) => l.db.playlists.add({ name: "Mine", episodeIds: [], createdAt: 0, updatedAt: 0 })],
  ])("is requested by %s as the first write", async (_label, write) => {
    const l = await seeded();
    await write(l, l.firstId);
    await settle();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("is requested by a position save that updates an existing progress entry", async () => {
    // A profile whose progress row predates the request (its pref was lost —
    // cleared site data that kept IndexedDB, or a pre-HD-010 profile).
    const l = await seeded();
    await l.db.progress.put({ fileHash: l.firstHash, playbackPosition: 10, lastPlayedAt: 1 });
    await settle();
    await l.db.userPrefs.clear();
    persist.mockClear();

    const again = await load();
    await again.progress.writeProgress(l.firstHash, { playbackPosition: 20 });
    await settle();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await again.db.progress.get(l.firstHash)).toEqual({ fileHash: l.firstHash, playbackPosition: 20, lastPlayedAt: 1 });
  });

  it("is not requested by a write that is not the listener's (a resolved sourceUrl)", async () => {
    const { db, firstId } = await seeded();
    await db.episodes.update(firstId, { sourceUrl: "https://archive.org/download/x/y.mp3" });
    await settle();
    expect(persist).not.toHaveBeenCalled();
  });

  it("is not requested when the transaction aborts — the write never happened", async () => {
    const { db, firstId } = await seeded();
    await expect(
      db.transaction("rw", db.episodes, async () => {
        await db.episodes.update(firstId, { favoritedAt: Date.now() });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    await settle();
    expect(persist).not.toHaveBeenCalled();
    expect((await db.episodes.get(firstId))?.favoritedAt).toBeUndefined();
  });

  it("records an already-persistent origin without asking", async () => {
    persisted.mockImplementation(() => Promise.resolve(true));
    const { management, firstId, db } = await seeded();
    await management.toggleFavorite(firstId);
    await settle();
    expect(persist).not.toHaveBeenCalled();
    expect(await db.userPrefs.where("key").equals("storage-persist-requested").first()).toBeTruthy();
  });

  it("does nothing, and throws nothing, where the Storage API is missing — and the write still lands", async () => {
    stubStorage(undefined);
    const { management, firstId, db } = await seeded();
    await expect(management.toggleFavorite(firstId)).resolves.toBe(true);
    await settle();
    expect((await db.episodes.get(firstId))?.favoritedAt).toBeGreaterThan(0);
    // Not recorded as asked: a browser that later gains the API should be asked.
    expect(await db.userPrefs.where("key").equals("storage-persist-requested").first()).toBeUndefined();
  });
});
