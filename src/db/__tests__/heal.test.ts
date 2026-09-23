import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Episode } from "../schema";

/**
 * The exact-2× heal for libraries already doubled by the seed race (HD-009).
 *
 * This is the one place outside a user confirmation that deletes episode rows,
 * so the assertions are on what SURVIVES: after a heal, every favourite,
 * rating, play, history row, bookmark, playlist slot and queue entry must still
 * be there and must point at a row that exists and is the same episode (same
 * fileHash) it pointed at before. And for every layout that is not exactly the
 * race's signature, the library must come out byte-for-byte as it went in.
 *
 * Real catalog, real Dexie, fake-indexeddb.
 */

vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));

const { db } = await import("../index");
const { healDoubledLibrary, planDoubledHeal } = await import("../heal");
const { toEpisodeRow } = await import("../seed");

const seedPath = path.resolve(__dirname, "../../../public/seed/library.json");
const catalogJson = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const catalogRows: Record<string, unknown>[] = Array.isArray(catalogJson) ? catalogJson : catalogJson.episodes;
const CATALOG_HASHES = catalogRows.map((r) => r.fileHash as string);
const CATALOG_SIZE = new Set(CATALOG_HASHES).size;

const SLOW = { timeout: 60_000 };

function serveCatalog() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: () => Promise.resolve(catalogJson) }) as Response),
  );
}

/** What two racing tabs left behind: the whole catalog, twice. Returns hash → [firstId, secondId]. */
async function doubleSeed(): Promise<Map<string, [number, number]>> {
  const now = 1_000;
  const rows = catalogRows.map((r) => ({ ...toEpisodeRow(r, now), lastPlayedAt: 0 }));
  const first = (await db.episodes.bulkAdd(rows as Episode[], { allKeys: true })) as number[];
  const second = (await db.episodes.bulkAdd(rows as Episode[], { allKeys: true })) as number[];
  const map = new Map<string, [number, number]>();
  rows.forEach((r, i) => map.set(r.fileHash, [first[i], second[i]]));
  return map;
}

async function singleSeed(): Promise<Map<string, number>> {
  const rows = catalogRows.map((r) => toEpisodeRow(r, 1_000));
  const ids = (await db.episodes.bulkAdd(rows as Episode[], { allKeys: true })) as number[];
  return new Map(rows.map((r, i) => [r.fileHash, ids[i]]));
}

async function snapshot() {
  return {
    episodes: await db.episodes.toArray(),
    history: await db.history.toArray(),
    bookmarks: await db.bookmarks.toArray(),
    playlists: await db.playlists.toArray(),
  };
}

async function hashOf(id: number): Promise<string | undefined> {
  return (await db.episodes.get(id))?.fileHash;
}

async function pref(key: string) {
  return (await db.userPrefs.where("key").equals(key).first())?.value;
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  if (!db.isOpen()) await db.open();
  await Promise.all([
    db.episodes.clear(), db.history.clear(), db.bookmarks.clear(),
    db.playlists.clear(), db.userPrefs.clear(),
  ]);
  serveCatalog();
});

describe("healDoubledLibrary — a doubled library heals", SLOW, () => {
  it("to exactly one row per catalog episode, with everything the listener did intact", async () => {
    const pairs = await doubleSeed();
    const [hA, hB, hC, hD] = CATALOG_HASHES;
    const [, a2] = pairs.get(hA)!;
    const [b1, b2] = pairs.get(hB)!;
    const [c1, c2] = pairs.get(hC)!;
    const [d1, d2] = pairs.get(hD)!;

    // User data scattered across BOTH copies, the way a doubled library
    // actually gets used: whichever row the list showed that day.
    await db.episodes.update(a2, { favoritedAt: 500, updatedAt: 2_000 });           // favourite on the twin
    await db.episodes.update(b1, { rating: 2, updatedAt: 2_000 });                  // older rating on keeper…
    await db.episodes.update(b2, { rating: 5, updatedAt: 3_000 });                  // …newer rating on twin
    await db.episodes.update(c1, { playCount: 2, lastPlayedAt: 10_000, playbackPosition: 100 });
    await db.episodes.update(c2, { playCount: 3, lastPlayedAt: 20_000, playbackPosition: 900 });
    await db.episodes.update(d2, { flaggedAt: 777 });

    await db.history.bulkAdd([
      { episodeId: a2, timestamp: 1, duration: 60 },
      { episodeId: c1, timestamp: 2, duration: 60 },
      { episodeId: c2, timestamp: 3, duration: 60 },
    ]);
    await db.bookmarks.bulkAdd([
      { episodeId: c2, position: 42, label: "the call", createdAt: 1 },
      { episodeId: b1, position: 7, label: "intro", createdAt: 2 },
    ]);
    const plId = (await db.playlists.add({
      name: "Best of", episodeIds: [a2, b1, c2, c1], createdAt: 0, updatedAt: 0,
    })) as number;
    const untouchedPl = (await db.playlists.add({
      name: "Untouched", episodeIds: [d1], createdAt: 0, updatedAt: 5,
    })) as number;
    await db.userPrefs.bulkAdd([
      { key: "queue-ids", value: JSON.stringify([c2, a2, d1]) },
      { key: "last-episode-id", value: String(c2) },
      { key: "volume", value: "0.4" },
    ]);

    const removed = await healDoubledLibrary();

    expect(removed).toBe(CATALOG_SIZE);
    const all = await db.episodes.toArray();
    expect(all).toHaveLength(CATALOG_SIZE);
    expect(new Set(all.map((e) => e.fileHash)).size).toBe(CATALOG_SIZE);

    const byHash = new Map(all.map((e) => [e.fileHash, e]));
    expect(byHash.get(hA)!.favoritedAt).toBe(500);
    expect(byHash.get(hB)!.rating).toBe(5);
    expect(byHash.get(hC)!.playCount).toBe(5);
    expect(byHash.get(hC)!.lastPlayedAt).toBe(20_000);
    expect(byHash.get(hC)!.playbackPosition).toBe(900);
    expect(byHash.get(hD)!.flaggedAt).toBe(777);

    // History: all three rows survive, each on a live row of the same episode.
    const history = await db.history.orderBy("timestamp").toArray();
    expect(history).toHaveLength(3);
    expect(await Promise.all(history.map((h) => hashOf(h.episodeId)))).toEqual([hA, hC, hC]);

    const bookmarks = await db.bookmarks.orderBy("createdAt").toArray();
    expect(bookmarks.map((b) => [b.label, b.position])).toEqual([["the call", 42], ["intro", 7]]);
    expect(await Promise.all(bookmarks.map((b) => hashOf(b.episodeId)))).toEqual([hC, hB]);

    // The playlist keeps its order and each episode once.
    const pl = (await db.playlists.get(plId))!;
    expect(await Promise.all(pl.episodeIds.map(hashOf))).toEqual([hA, hB, hC]);
    const other = (await db.playlists.get(untouchedPl))!;
    expect(other.episodeIds).toEqual([d1]);
    expect(other.updatedAt).toBe(5);

    // The saved queue and last-played restore to live rows of the same shows.
    const queue = JSON.parse((await pref("queue-ids"))!) as number[];
    expect(await Promise.all(queue.map(hashOf))).toEqual([hC, hA, hD]);
    expect(await hashOf(parseInt((await pref("last-episode-id"))!, 10))).toBe(hC);
    expect(await pref("volume")).toBe("0.4");
  });

  it("leaves non-catalog rows alone, even when they are duplicated", async () => {
    await doubleSeed();
    const local = { fileHash: "md5:abc", filePath: "/x.mp3", fileName: "x.mp3", fileSize: 1, source: "local", createdAt: 0, updatedAt: 0 };
    const l1 = (await db.episodes.add({ ...local } as Episode)) as number;
    const l2 = (await db.episodes.add({ ...local } as Episode)) as number;

    await healDoubledLibrary();

    expect(await db.episodes.count()).toBe(CATALOG_SIZE + 2);
    expect(await db.episodes.get(l1)).toBeDefined();
    expect(await db.episodes.get(l2)).toBeDefined();
  });

  it("tolerates a show the user deliberately deleted one copy of", async () => {
    const pairs = await doubleSeed();
    const [h0] = CATALOG_HASHES;
    await db.episodes.delete(pairs.get(h0)![1]);
    await db.userPrefs.add({ key: "deleted-hashes", value: JSON.stringify([h0]) });

    await healDoubledLibrary();

    expect(await db.episodes.count()).toBe(CATALOG_SIZE);
    expect(await db.episodes.where("fileHash").equals(h0).count()).toBe(1);
  });
});

describe("healDoubledLibrary — rails: anything but the exact signature is not touched", SLOW, () => {
  it("a library with one TRIPLED episode is left exactly as it was", async () => {
    const pairs = await doubleSeed();
    const [h0] = CATALOG_HASHES;
    const extra = { ...(await db.episodes.get(pairs.get(h0)![0]))! };
    delete extra.id;
    await db.episodes.add(extra);
    await db.history.add({ episodeId: pairs.get(h0)![1], timestamp: 1, duration: 1 });
    const before = await snapshot();

    expect(await healDoubledLibrary()).toBe(0);

    expect(await snapshot()).toEqual(before);
    expect(before.episodes).toHaveLength(2 * CATALOG_SIZE + 1);
  });

  it("a healthy library with ONE user-imported duplicate is left exactly as it was", async () => {
    // That duplicate is deduplicateEpisodes()' business, behind a confirmation
    // — never an automatic merge.
    const ids = await singleSeed();
    const [h0] = CATALOG_HASHES;
    const dupe = { ...(await db.episodes.get(ids.get(h0)!))! };
    delete dupe.id;
    const dupeId = (await db.episodes.add({ ...dupe, favoritedAt: 99 })) as number;
    await db.bookmarks.add({ episodeId: dupeId, position: 1, label: "mine", createdAt: 1 });
    const before = await snapshot();

    expect(await healDoubledLibrary()).toBe(0);

    expect(await snapshot()).toEqual(before);
    expect(before.episodes).toHaveLength(CATALOG_SIZE + 1);
  });

  it("a healthy library costs an index scan only — the catalog is not fetched", async () => {
    await singleSeed();
    await healDoubledLibrary();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(await db.episodes.count()).toBe(CATALOG_SIZE);
  });
});

describe("planDoubledHeal (pure)", () => {
  const ep = (id: number, fileHash: string) => ({ id, fileHash, fileName: "", filePath: "", fileSize: 0, createdAt: 0, updatedAt: 0 }) as Episode;
  const cat = new Set(["a", "b"]);

  it("keeps the lower id of each pair", () => {
    const plan = planDoubledHeal([ep(3, "a"), ep(1, "a"), ep(2, "b"), ep(4, "b")], cat);
    expect(plan.ok && plan.merges.map((m) => [m.keeper.id, m.twins.map((t) => t.id)])).toEqual([[1, [3]], [2, [4]]]);
  });

  it("refuses a catalog hash present once unless it is tombstoned", () => {
    expect(planDoubledHeal([ep(1, "a"), ep(2, "a"), ep(3, "b")], cat).ok).toBe(false);
    expect(planDoubledHeal([ep(1, "a"), ep(2, "a"), ep(3, "b")], cat, new Set(["b"])).ok).toBe(true);
  });
});
