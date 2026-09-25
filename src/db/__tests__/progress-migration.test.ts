import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Dexie from "dexie";
import fs from "node:fs";
import path from "node:path";
import type { Progress, StoredEpisode } from "../schema";
import { mergeProgress, legacyProgressOf } from "../progress-migration";

/**
 * The Dexie v9 upgrade (HD-016): playback position and last-played are COPIED
 * from every episode row into the new `progress` table, keyed by fileHash.
 *
 * Driven for real, on the real catalog: a database is built at v8 with a raw
 * Dexie that declares the v8 schema verbatim and is seeded the way the seeder
 * seeds it (all 1,312 rows), with a spread of listening on top — then closed and
 * opened by the app's real `db`, which is what runs the upgrade, exactly as a
 * returning visitor's browser does.
 *
 * Two properties, both on stored rows:
 *   1. Every position and last-played arrives in `progress`, and nothing else
 *      does (an unplayed row gets no entry).
 *   2. Every other thing is untouched: every field of every episode row —
 *      including the legacy fields themselves, which the upgrade leaves in
 *      place — and every row of every other table.
 */

vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() },
  useToastStore: { getState: () => ({ toasts: [] }) },
}));

const V8 = {
  episodes:
    "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, archiveIdentifier, lastPlayedAt, aiStatus, favoritedAt, flaggedAt, aiCategory, aiSeries, *aiTags",
  scanSessions: "++id, status, startedAt",
  userPrefs: "++id, &key",
  playlists: "++id, name, createdAt",
  history: "++id, episodeId, timestamp",
  bookmarks: "++id, episodeId, position, createdAt",
};

const seedPath = path.resolve(__dirname, "../../../public/seed/library.json");
const catalogJson = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const catalogRows: Record<string, unknown>[] = Array.isArray(catalogJson) ? catalogJson : catalogJson.episodes;

type DbModule = typeof import("../index");
let appDb: DbModule["db"] | null = null;

async function dumpAll(d: Dexie) {
  return {
    episodes: await d.table("episodes").toArray(),
    history: await d.table("history").toArray(),
    bookmarks: await d.table("bookmarks").toArray(),
    playlists: await d.table("playlists").toArray(),
    userPrefs: await d.table("userPrefs").toArray(),
    scanSessions: await d.table("scanSessions").toArray(),
  };
}

async function upgrade(): Promise<DbModule["db"]> {
  vi.resetModules();
  const { db } = await import("../index");
  await db.open();
  appDb = db;
  return db;
}

beforeEach(async () => {
  await Dexie.delete("HighDesertDB");
});
afterEach(async () => {
  appDb?.close();
  appDb = null;
  await Dexie.delete("HighDesertDB");
});

describe("v9 upgrade — a real seeded library", () => {
  it("copies every position and last-played into progress, and changes nothing else", { timeout: 60_000 }, async () => {
    const { toEpisodeRow } = await import("../seed");
    const rows: StoredEpisode[] = catalogRows.map((r) => ({ ...toEpisodeRow(r, 1_000), lastPlayedAt: 0 }) as StoredEpisode);
    expect(rows.length).toBeGreaterThan(1_000);

    // A spread of listening: position + last-played, position only, played
    // only, plus rows with favourites/ratings and no listening (controls).
    const h = (i: number) => rows[i].fileHash;
    Object.assign(rows[0], { playbackPosition: 1234.5, lastPlayedAt: 1_700_000_000_000 });
    Object.assign(rows[1], { playbackPosition: 60 }); // positioned, lastPlayedAt stays 0
    Object.assign(rows[2], { lastPlayedAt: 1_700_000_500_000, playCount: 2 }); // finished: position 0
    Object.assign(rows[3], { favoritedAt: 5, rating: 4 });
    Object.assign(rows[rows.length - 1], { playbackPosition: 9_000, lastPlayedAt: 42, flaggedAt: 7 });

    // A doubled pair (the HD-009 race, not yet healed): one entry, the later play's position.
    const twin: StoredEpisode = { ...rows[4], playbackPosition: 300, lastPlayedAt: 200 };
    Object.assign(rows[4], { playbackPosition: 100, lastPlayedAt: 100 });

    const old = new Dexie("HighDesertDB");
    old.version(8).stores(V8);
    await old.open();
    await old.table("episodes").bulkAdd([...rows, twin]);
    await old.table("history").bulkAdd([{ episodeId: 1, timestamp: 5, duration: 60 }]);
    await old.table("bookmarks").bulkAdd([{ episodeId: 1, position: 30, label: "x", createdAt: 1 }]);
    await old.table("playlists").bulkAdd([{ name: "P", episodeIds: [1, 2], createdAt: 1, updatedAt: 1 }]);
    await old.table("userPrefs").bulkAdd([{ key: "k", value: "v" }]);
    const before = await dumpAll(old);
    old.close();

    const db = await upgrade();
    expect(db.verno).toBe(9);

    // 1. Exactly the listened rows, with exactly their numbers.
    const progress = (await db.progress.toArray()).sort((a, b) => a.fileHash.localeCompare(b.fileHash));
    const expected: Progress[] = [
      { fileHash: h(0), playbackPosition: 1234.5, lastPlayedAt: 1_700_000_000_000 },
      { fileHash: h(1), playbackPosition: 60 },
      { fileHash: h(2), lastPlayedAt: 1_700_000_500_000 },
      { fileHash: h(4), playbackPosition: 300, lastPlayedAt: 200 },
      { fileHash: rows[rows.length - 1].fileHash, playbackPosition: 9_000, lastPlayedAt: 42 },
    ].sort((a, b) => a.fileHash.localeCompare(b.fileHash));
    expect(progress).toEqual(expected);

    // 2. Every other field of every row, and every other table, untouched.
    const after = await dumpAll(db);
    expect(after.episodes.length).toBe(before.episodes.length);
    expect(after).toEqual(before);

    // The dropped index: a stray query against frozen data fails loudly.
    await expect(db.episodes.where("lastPlayedAt").above(0).toArray()).rejects.toThrow();
  });

  it("an unplayed library gets an empty progress table and no row changes", async () => {
    const { toEpisodeRow } = await import("../seed");
    const rows = catalogRows.slice(0, 50).map((r) => ({ ...toEpisodeRow(r, 1_000), lastPlayedAt: 0 }));
    const old = new Dexie("HighDesertDB");
    old.version(8).stores(V8);
    await old.open();
    await old.table("episodes").bulkAdd(rows);
    const before = await dumpAll(old);
    old.close();

    const db = await upgrade();
    expect(await db.progress.count()).toBe(0);
    expect(await dumpAll(db)).toEqual(before);
  });
});

describe("mergeProgress / legacyProgressOf (pure)", () => {
  it("takes the later last-played and the position that goes with it", () => {
    const a = { fileHash: "h", playbackPosition: 10, lastPlayedAt: 1 };
    const b = { fileHash: "h", playbackPosition: 20, lastPlayedAt: 2 };
    expect(mergeProgress(a, b)).toEqual({ fileHash: "h", playbackPosition: 20, lastPlayedAt: 2 });
    expect(mergeProgress(b, a)).toEqual({ fileHash: "h", playbackPosition: 20, lastPlayedAt: 2 });
  });

  it("falls back to whichever entry has a position", () => {
    expect(mergeProgress({ fileHash: "h", lastPlayedAt: 5 }, { fileHash: "h", playbackPosition: 7 }))
      .toEqual({ fileHash: "h", playbackPosition: 7, lastPlayedAt: 5 });
  });

  it("an unplayed, unpositioned row has no progress", () => {
    expect(legacyProgressOf({ fileHash: "h", playbackPosition: 0, lastPlayedAt: 0 } as StoredEpisode)).toBeNull();
    expect(legacyProgressOf({ fileHash: "h" } as StoredEpisode)).toBeNull();
  });
});
