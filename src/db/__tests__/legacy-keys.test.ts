import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Dexie from "dexie";
import type { Episode } from "../schema";
import { planLegacyKeyMigration } from "../legacy-keys";

/**
 * The Dexie v8 upgrade: legacy `archive:{identifier}` keys written by the old
 * catalog scraper become canonical `archive:{identifier}:{fileName}` (HD-025).
 *
 * Driven for real: a database is built at v7 with a raw Dexie that declares the
 * v7 schema verbatim, closed, and then opened by the app's real `db`, which is
 * what runs the upgrade — exactly as a returning visitor's browser does.
 * Assertions are on what SURVIVES: every row, favourite, rating, play, history
 * row, bookmark, playlist slot and queue entry, and what each now points at.
 */

const V7 = {
  episodes:
    "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, archiveIdentifier, lastPlayedAt, aiStatus, favoritedAt, flaggedAt, aiCategory, aiSeries, *aiTags",
  scanSessions: "++id, status, startedAt",
  userPrefs: "++id, &key",
  playlists: "++id, name, createdAt",
  history: "++id, episodeId, timestamp",
  bookmarks: "++id, episodeId, position, createdAt",
};

type DbModule = typeof import("../index");
let appDb: DbModule["db"] | null = null;

function ep(over: Partial<Episode>): Episode {
  return {
    filePath: "", fileName: "", fileSize: 0, source: "archive",
    createdAt: 0, updatedAt: 0, ...over,
  } as Episode;
}

/** Build a v7 database, run `fill`, close it. */
async function atV7(fill: (old: Dexie) => Promise<void>): Promise<void> {
  const old = new Dexie("HighDesertDB");
  old.version(7).stores(V7);
  await old.open();
  await fill(old);
  old.close();
}

/** Open the app's real db — this is what runs the v8 upgrade. */
async function upgrade(): Promise<DbModule["db"]> {
  vi.resetModules();
  const { db } = await import("../index");
  await db.open();
  appDb = db;
  return db;
}

async function dump(d: Dexie) {
  return {
    episodes: await d.table("episodes").toArray(),
    history: await d.table("history").toArray(),
    bookmarks: await d.table("bookmarks").toArray(),
    playlists: await d.table("playlists").toArray(),
    userPrefs: await d.table("userPrefs").toArray(),
  };
}

beforeEach(async () => {
  await Dexie.delete("HighDesertDB");
});
afterEach(async () => {
  appDb?.close();
  appDb = null;
  await Dexie.delete("HighDesertDB");
});

describe("v8 upgrade — a legacy library", () => {
  it("canonicalises every legacy key, merges the collision, and orphans nothing", async () => {
    const ids: Record<string, number> = {};

    await atV7(async (old) => {
      const E = old.table<Episode, number>("episodes");
      // Seed catalog row — canonical, must not change.
      ids.seed = await E.add(ep({
        fileHash: "archive:ultimate-ultimate-art-bell-collection:1997-03-13.mp3",
        fileName: "1997-03-13.mp3", archiveIdentifier: "ultimate-ultimate-art-bell-collection",
        title: "Phoenix Lights", favoritedAt: 42,
      }));
      // Scraped, no canonical twin: renamed in place, keeps its id.
      ids.lone = await E.add(ep({
        fileHash: "archive:coast-1998-01-01", fileName: "coast-1998-01-01.mp3",
        archiveIdentifier: "coast-1998-01-01", title: "Lone", favoritedAt: 7, playCount: 1,
      }));
      // Scraped, AND the same file arrived by collection import: merged.
      ids.canon = await E.add(ep({
        fileHash: "archive:coast-1998-02-02:coast-1998-02-02.mp3", fileName: "coast-1998-02-02.mp3",
        archiveIdentifier: "coast-1998-02-02", title: "Twin", playCount: 1, lastPlayedAt: 100,
        playbackPosition: 10, favoritedAt: 50, updatedAt: 1,
      }));
      ids.legacy = await E.add(ep({
        fileHash: "archive:coast-1998-02-02", fileName: "coast-1998-02-02.mp3",
        archiveIdentifier: "coast-1998-02-02", title: "Twin", playCount: 3, lastPlayedAt: 900,
        playbackPosition: 600, rating: 5, flaggedAt: 11, updatedAt: 2,
      }));
      // Look-alikes that are NOT legacy scraper rows — must be left alone.
      ids.slashy = await E.add(ep({
        fileHash: "archive:coll/x.mp3", fileName: "x.mp3", archiveIdentifier: "coll/x.mp3",
      }));
      ids.local = await E.add(ep({ fileHash: "d41d8cd98f00b204e9800998ecf8427e", fileName: "tape.mp3", source: "local" }));

      await old.table("history").bulkAdd([
        { episodeId: ids.lone, timestamp: 1, duration: 60 },
        { episodeId: ids.legacy, timestamp: 2, duration: 60 },
        { episodeId: ids.legacy, timestamp: 3, duration: 60 },
        { episodeId: ids.canon, timestamp: 4, duration: 60 },
        { episodeId: ids.seed, timestamp: 5, duration: 60 },
      ]);
      await old.table("bookmarks").bulkAdd([
        { episodeId: ids.legacy, position: 300, label: "the caller", createdAt: 1 },
        { episodeId: ids.lone, position: 5, label: "open", createdAt: 2 },
      ]);
      await old.table("playlists").bulkAdd([
        { name: "Mix", episodeIds: [ids.legacy, ids.seed, ids.canon, ids.lone], createdAt: 0, updatedAt: 0 },
        { name: "Seed only", episodeIds: [ids.seed], createdAt: 0, updatedAt: 9 },
      ]);
      await old.table("userPrefs").bulkAdd([
        { key: "queue-ids", value: JSON.stringify([ids.legacy, ids.lone]) },
        { key: "last-episode-id", value: String(ids.legacy) },
        { key: "volume", value: "0.3" },
      ]);
    });

    const db = await upgrade();
    const after = await dump(db);
    const byId = new Map(after.episodes.map((e) => [e.id, e as Episode]));

    // Exactly one row gone — the legacy twin — and no duplicate identities.
    expect(after.episodes).toHaveLength(5);
    expect(byId.has(ids.legacy)).toBe(false);
    const hashes = after.episodes.map((e) => e.fileHash);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes.filter((h) => /^archive:[^:]+$/.test(h))).toEqual(["archive:coll/x.mp3"]);

    // Renamed in place, same id, data intact.
    expect(byId.get(ids.lone)).toMatchObject({
      fileHash: "archive:coast-1998-01-01:coast-1998-01-01.mp3", favoritedAt: 7, playCount: 1,
    });

    // The canonical row absorbed everything the legacy twin carried.
    expect(byId.get(ids.canon)).toMatchObject({
      fileHash: "archive:coast-1998-02-02:coast-1998-02-02.mp3",
      favoritedAt: 50, rating: 5, flaggedAt: 11,
      playCount: 4, lastPlayedAt: 900, playbackPosition: 600,
    });

    // Untouched rows are untouched.
    expect(byId.get(ids.seed)).toMatchObject({ favoritedAt: 42, title: "Phoenix Lights" });
    expect(byId.get(ids.slashy)!.fileHash).toBe("archive:coll/x.mp3");
    expect(byId.get(ids.local)!.fileHash).toBe("d41d8cd98f00b204e9800998ecf8427e");

    // Every relation survives and points at a live row of the same episode.
    expect(after.history).toHaveLength(5);
    expect(after.history.every((h) => byId.has(h.episodeId))).toBe(true);
    expect(after.history.map((h) => h.episodeId)).toEqual([ids.lone, ids.canon, ids.canon, ids.canon, ids.seed]);
    expect(after.bookmarks.map((b) => [b.label, b.episodeId])).toEqual([["the caller", ids.canon], ["open", ids.lone]]);

    const [mix, seedOnly] = after.playlists;
    expect(mix.episodeIds).toEqual([ids.canon, ids.seed, ids.lone]);
    expect(seedOnly).toMatchObject({ episodeIds: [ids.seed], updatedAt: 9 });

    const prefs = new Map(after.userPrefs.map((p) => [p.key, p.value]));
    expect(JSON.parse(prefs.get("queue-ids")!)).toEqual([ids.canon, ids.lone]);
    expect(prefs.get("last-episode-id")).toBe(String(ids.canon));
    expect(prefs.get("volume")).toBe("0.3");
  });
});

describe("v8 upgrade — a canonical library", () => {
  it("comes out exactly as it went in", async () => {
    let before: Awaited<ReturnType<typeof dump>> | null = null;
    await atV7(async (old) => {
      const E = old.table<Episode, number>("episodes");
      const a = await E.add(ep({
        fileHash: "archive:ultimate-ultimate-art-bell-collection:a.mp3", fileName: "a.mp3",
        archiveIdentifier: "ultimate-ultimate-art-bell-collection", favoritedAt: 1, rating: 4, updatedAt: 3,
      }));
      const b = await E.add(ep({
        fileHash: "archive:coast-1999:coast-1999.mp3", fileName: "coast-1999.mp3",
        archiveIdentifier: "coast-1999", playCount: 2, lastPlayedAt: 5, updatedAt: 4,
      }));
      await old.table("history").add({ episodeId: a, timestamp: 1, duration: 1 });
      await old.table("bookmarks").add({ episodeId: b, position: 1, label: "x", createdAt: 1 });
      await old.table("playlists").add({ name: "p", episodeIds: [b, a], createdAt: 0, updatedAt: 2 });
      await old.table("userPrefs").add({ key: "queue-ids", value: JSON.stringify([a, b]) });
      before = await dump(old);
    });

    const db = await upgrade();
    expect(db.verno).toBe(8);
    expect(await dump(db)).toEqual(before);
  });
});

describe("planLegacyKeyMigration (pure)", () => {
  it("skips an oversized collision group rather than guessing", () => {
    const rows = [1, 2, 3, 4].map((id) => ep({
      id, fileHash: id === 1 ? "archive:i:f.mp3" : "archive:i", archiveIdentifier: "i", fileName: "f.mp3",
    }));
    const plan = planLegacyKeyMigration(rows);
    expect(plan.skipped).toEqual(["archive:i:f.mp3"]);
    expect(plan.renames.size + plan.merges.size).toBe(0);
  });
});
