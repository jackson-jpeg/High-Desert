import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `deleteEpisode` is the highest-stakes function in this repo.
 *
 * All user data — favourites, ratings, playback positions, history, bookmarks —
 * lives only in the visitor's IndexedDB. There is no server backup. This
 * function writes to five tables, and an automatic caller of its batch form once
 * deleted 1,312 of 1,313 episodes.
 *
 * So this drives the real function against a real database and asserts on stored
 * rows, never on return values. Three properties, all of which have failure
 * modes that are invisible from inside the call:
 *
 *   1. **The cascade reaches everything** — history, bookmarks, playlists — and
 *      **nothing else**. A cascade that is too wide is the incident; a cascade
 *      that is too narrow leaves orphan rows pointing at a missing episode.
 *   2. **The tombstone is written**, so the deletion is remembered.
 *   3. **`reconcileLibrary()` honours it.** Proven end to end, with a control
 *      that deletes the same row *without* a tombstone and shows reconcile does
 *      resurrect it — otherwise "reconcile restored nothing" is not evidence of
 *      anything, since a reconcile that never runs would pass just as well.
 *
 * That third point is the whole reason this file exists rather than another unit
 * test of `planReconcile`, which is pure and already covered.
 */

const removeCachedAudio = vi.fn(() => Promise.resolve());

vi.mock("@/audio/cache", () => ({
  removeCachedAudio: (...a: unknown[]) => removeCachedAudio(...(a as [])),
  isOPFSSupported: () => false,
}));

// seed.ts toasts on catalog-fetch failure; nothing here should reach it, and a
// real toast store would make that silent if it did.
vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));

const { db } = await import("@/db");
const { deleteEpisode, deleteEpisodes, addBookmark } = await import(
  "../management"
);
const { reconcileLibrary, SEED_VERSION } = await import("@/db/seed");
const { usePlayerStore } = await import("@/stores/player-store");

type Row = Record<string, unknown>;

/**
 * A three-row catalog. Deliberately not the real 1,312-row file: identity across
 * the real catalog is `reconcile.test.ts`'s job, and this needs a fetch it can
 * control.
 */
const CATALOG = [
  { fileHash: "archive:coll:1997-07-28.mp3", fileName: "1997-07-28.mp3", title: "Men in Black" },
  { fileHash: "archive:coll:1997-08-15.mp3", fileName: "1997-08-15.mp3", title: "Whitley Strieber" },
  { fileHash: "archive:coll:1997-09-02.mp3", fileName: "1997-09-02.mp3", title: "Hoagland on Mars" },
];

async function seedEpisode(over: Row = {}): Promise<number> {
  const id = await db.episodes.add({
    fileHash: `archive:coll:show-${Math.random()}.mp3`,
    filePath: "",
    fileName: "show.mp3",
    fileSize: 0,
    showType: "coast",
    source: "archive",
    createdAt: 0,
    updatedAt: 0,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return id as number;
}

/** Seed the catalog as local rows and hand back hash -> id. */
async function seedCatalog(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const row of CATALOG) {
    map.set(row.fileHash, await seedEpisode({ fileHash: row.fileHash, fileName: row.fileName, title: row.title }));
  }
  return map;
}

/** Open reconcile's version gate and serve the catalog. */
function armReconcile() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(CATALOG) } as Response),
    ),
  );
}

async function tombstones(): Promise<string[]> {
  const pref = await db.userPrefs.where("key").equals("deleted-hashes").first();
  return pref ? (JSON.parse(pref.value) as string[]) : [];
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  if (!db.isOpen()) await db.open();
  await Promise.all([
    db.episodes.clear(),
    db.history.clear(),
    db.bookmarks.clear(),
    db.playlists.clear(),
    db.userPrefs.clear(),
  ]);
  usePlayerStore.getState().stop();
});

describe("deleteEpisode — the cascade", () => {
  it("removes the episode row itself", async () => {
    const id = await seedEpisode();
    await deleteEpisode(id);
    expect(await db.episodes.get(id)).toBeUndefined();
  });

  it("deletes that episode's history, bookmarks and playlist membership — and only that episode's", async () => {
    // A neighbour in every table. The incident here was blast radius, so the
    // assertion that matters is what SURVIVES.
    const doomed = await seedEpisode({ title: "doomed" });
    const keeper = await seedEpisode({ title: "keeper" });

    await db.history.bulkAdd([
      { episodeId: doomed, timestamp: 1, duration: 60 },
      { episodeId: doomed, timestamp: 2, duration: 90 },
      { episodeId: keeper, timestamp: 3, duration: 30 },
    ]);
    await addBookmark(doomed, 120, "the callers start");
    await addBookmark(keeper, 300, "bumper music");
    const plId = (await db.playlists.add({
      name: "Best of 1997",
      episodeIds: [doomed, keeper],
      createdAt: 0,
      updatedAt: 0,
    })) as number;

    await deleteEpisode(doomed);

    expect(await db.history.where("episodeId").equals(doomed).count()).toBe(0);
    expect(await db.bookmarks.where("episodeId").equals(doomed).count()).toBe(0);

    // The neighbour is untouched.
    expect(await db.history.where("episodeId").equals(keeper).count()).toBe(1);
    expect(await db.bookmarks.where("episodeId").equals(keeper).count()).toBe(1);
    expect(await db.episodes.get(keeper)).toBeDefined();

    const pl = await db.playlists.get(plId);
    expect(pl!.episodeIds).toEqual([keeper]);
  });

  it("touches a playlist only when it actually contained the episode", async () => {
    const doomed = await seedEpisode();
    const other = await seedEpisode();
    const unrelated = (await db.playlists.add({
      name: "Dreamland",
      episodeIds: [other],
      createdAt: 0,
      updatedAt: 7,
    })) as number;

    await deleteEpisode(doomed);

    const pl = await db.playlists.get(unrelated);
    expect(pl!.episodeIds).toEqual([other]);
    // updatedAt is the tell: a blanket rewrite would bump every playlist and
    // make "last modified" meaningless across the user's whole collection.
    expect(pl!.updatedAt).toBe(7);
  });

  it("stamps updatedAt on a playlist it did edit", async () => {
    const doomed = await seedEpisode();
    const plId = (await db.playlists.add({
      name: "Best of 1997",
      episodeIds: [doomed],
      createdAt: 0,
      updatedAt: 7,
    })) as number;

    await deleteEpisode(doomed);

    const pl = await db.playlists.get(plId);
    expect(pl!.episodeIds).toEqual([]);
    expect(pl!.updatedAt).toBeGreaterThan(7);
  });

  it("drops the cached audio blob, keyed by fileHash", async () => {
    const id = await seedEpisode({ fileHash: "archive:coll:cached.mp3" });
    await deleteEpisode(id);
    expect(removeCachedAudio).toHaveBeenCalledWith("archive:coll:cached.mp3");
  });

  it("does nothing at all for an id that is not there", async () => {
    const keeper = await seedEpisode();
    await db.history.add({ episodeId: keeper, timestamp: 1, duration: 60 });

    await deleteEpisode(99999);

    expect(await db.episodes.get(keeper)).toBeDefined();
    expect(await db.history.count()).toBe(1);
    // And critically: no tombstone. A tombstone for a hash that was never
    // deleted would suppress a legitimate catalog row forever.
    expect(await tombstones()).toEqual([]);
    expect(removeCachedAudio).not.toHaveBeenCalled();
  });
});

describe("deleteEpisode — the player", () => {
  it("stops playback when the episode being deleted is the one playing", async () => {
    const id = await seedEpisode({ title: "now playing" });
    const ep = await db.episodes.get(id);
    usePlayerStore.setState({ currentEpisode: ep!, playing: true, queue: [ep!], queueIndex: 0 });

    await deleteEpisode(id);

    const s = usePlayerStore.getState();
    expect(s.currentEpisode).toBeNull();
    expect(s.playing).toBe(false);
  });

  it("removes a queued episode without disturbing the rest of the queue", async () => {
    const a = await seedEpisode({ title: "a" });
    const b = await seedEpisode({ title: "b" });
    const c = await seedEpisode({ title: "c" });
    const rows = await db.episodes.bulkGet([a, b, c]);
    usePlayerStore.setState({
      currentEpisode: rows[0]!,
      playing: true,
      queue: [rows[0]!, rows[1]!, rows[2]!],
      queueIndex: 0,
    });

    await deleteEpisode(b);

    const s = usePlayerStore.getState();
    // Still playing `a` — deleting something further down the queue must not
    // stop the show.
    expect(s.currentEpisode?.id).toBe(a);
    expect(s.playing).toBe(true);
    expect(s.queue.map((e) => e.id)).toEqual([a, c]);
  });
});

describe("deleteEpisode — the tombstone", () => {
  it("records the deleted episode's fileHash", async () => {
    const id = await seedEpisode({ fileHash: "archive:coll:gone.mp3" });
    await deleteEpisode(id);
    expect(await tombstones()).toEqual(["archive:coll:gone.mp3"]);
  });

  it("accumulates across deletions without duplicating", async () => {
    const one = await seedEpisode({ fileHash: "archive:coll:one.mp3" });
    const two = await seedEpisode({ fileHash: "archive:coll:two.mp3" });

    await deleteEpisodes([one, two]);

    expect((await tombstones()).sort()).toEqual([
      "archive:coll:one.mp3",
      "archive:coll:two.mp3",
    ]);
  });

  it("deleteEpisodes cascades for every id, not just the first", async () => {
    const one = await seedEpisode();
    const two = await seedEpisode();
    await db.history.bulkAdd([
      { episodeId: one, timestamp: 1, duration: 10 },
      { episodeId: two, timestamp: 2, duration: 10 },
    ]);

    await deleteEpisodes([one, two]);

    expect(await db.episodes.count()).toBe(0);
    expect(await db.history.count()).toBe(0);
  });
});

describe("reconcileLibrary must not resurrect a deleted episode", () => {
  it("CONTROL: a row removed without a tombstone IS restored", async () => {
    // Without this, the next test proves nothing — a reconcile that silently
    // does nothing would satisfy it just as well as one that honours
    // tombstones. This is the disconnected-check trap, and it is exactly the
    // shape the previous version of clear-field.test.ts fell into.
    const ids = await seedCatalog();
    await db.episodes.delete(ids.get("archive:coll:1997-08-15.mp3")!);
    expect(await db.episodes.count()).toBe(2);

    armReconcile();
    const restored = await reconcileLibrary();

    expect(restored).toBe(1);
    const hashes = (await db.episodes.toArray()).map((e) => e.fileHash);
    expect(hashes).toContain("archive:coll:1997-08-15.mp3");
  });

  it("a row deleted through deleteEpisode stays deleted", async () => {
    const ids = await seedCatalog();
    await deleteEpisode(ids.get("archive:coll:1997-08-15.mp3")!);
    expect(await db.episodes.count()).toBe(2);

    armReconcile();
    const restored = await reconcileLibrary();

    expect(restored).toBe(0);
    const hashes = (await db.episodes.toArray()).map((e) => e.fileHash);
    expect(hashes).not.toContain("archive:coll:1997-08-15.mp3");
    expect(hashes).toHaveLength(2);
  });

  it("still restores the episodes the user did not delete", async () => {
    // The tombstone must suppress one row, not switch reconcile off. A user who
    // deletes one show and then loses the rest to a wipe still needs the rest
    // back — that is what reconcileLibrary is for.
    const ids = await seedCatalog();
    await deleteEpisode(ids.get("archive:coll:1997-08-15.mp3")!);
    // Now lose one more the way the dedup bug did — no tombstone.
    await db.episodes.delete(ids.get("archive:coll:1997-09-02.mp3")!);
    expect(await db.episodes.count()).toBe(1);

    armReconcile();
    const restored = await reconcileLibrary();

    expect(restored).toBe(1);
    const hashes = (await db.episodes.toArray()).map((e) => e.fileHash).sort();
    expect(hashes).toEqual([
      "archive:coll:1997-07-28.mp3",
      "archive:coll:1997-09-02.mp3",
    ]);
  });

  it("marks itself done so a healthy library fetches the catalog at most once", async () => {
    await seedCatalog();
    armReconcile();

    await reconcileLibrary();
    const pref = await db.userPrefs.where("key").equals("seed-reconciled").first();
    expect(pref?.value).toBe(SEED_VERSION);

    // Second run must not fetch again.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
    expect(await reconcileLibrary()).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
