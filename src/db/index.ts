import Dexie, { type EntityTable } from "dexie";
import { installPersistRequest } from "./persist";
import type { Episode, ScanSession, UserPrefs, Playlist, HistoryEntry, Bookmark, Progress } from "./schema";
import { migrateLegacyScraperKeys } from "./legacy-keys";
import { copyLegacyProgress } from "./progress-migration";

export type { Episode, ScanSession, UserPrefs, Playlist, HistoryEntry, Bookmark, Progress };

class HighDesertDB extends Dexie {
  episodes!: EntityTable<Episode, "id">;
  scanSessions!: EntityTable<ScanSession, "id">;
  userPrefs!: EntityTable<UserPrefs, "id">;
  playlists!: EntityTable<Playlist, "id">;
  history!: EntityTable<HistoryEntry, "id">;
  bookmarks!: EntityTable<Bookmark, "id">;
  progress!: EntityTable<Progress, "fileHash">;

  constructor() {
    super("HighDesertDB");

    this.version(1).stores({
      episodes:
        "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, *aiTags",
      scanSessions: "++id, status, startedAt",
      userPrefs: "++id, &key",
    });

    this.version(2).stores({
      episodes:
        "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, archiveIdentifier, *aiTags",
      scanSessions: "++id, status, startedAt",
      userPrefs: "++id, &key",
    });

    this.version(3).stores({
      episodes:
        "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, archiveIdentifier, lastPlayedAt, aiStatus, *aiTags",
      scanSessions: "++id, status, startedAt",
      userPrefs: "++id, &key",
    }).upgrade((tx) => {
      return tx.table("episodes").toCollection().modify((ep) => {
        if (ep.aiStatus === undefined) ep.aiStatus = "pending";
        if (ep.lastPlayedAt === undefined) ep.lastPlayedAt = 0;
      });
    });

    this.version(4).stores({
      episodes:
        "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, archiveIdentifier, lastPlayedAt, aiStatus, favoritedAt, *aiTags",
      scanSessions: "++id, status, startedAt",
      userPrefs: "++id, &key",
      playlists: "++id, name, createdAt",
      history: "++id, episodeId, timestamp",
    }).upgrade((tx) => {
      return tx.table("episodes").toCollection().modify((ep) => {
        if (ep.favoritedAt === undefined) ep.favoritedAt = undefined;
      });
    });

    this.version(5).stores({
      episodes:
        "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, archiveIdentifier, lastPlayedAt, aiStatus, favoritedAt, *aiTags",
      scanSessions: "++id, status, startedAt",
      userPrefs: "++id, &key",
      playlists: "++id, name, createdAt",
      history: "++id, episodeId, timestamp",
      bookmarks: "++id, episodeId, position, createdAt",
    });

    this.version(6).stores({
      episodes:
        "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, archiveIdentifier, lastPlayedAt, aiStatus, favoritedAt, aiCategory, aiSeries, *aiTags",
      scanSessions: "++id, status, startedAt",
      userPrefs: "++id, &key",
      playlists: "++id, name, createdAt",
      history: "++id, episodeId, timestamp",
      bookmarks: "++id, episodeId, position, createdAt",
    }).upgrade((tx) => {
      return tx.table("episodes").toCollection().modify((ep) => {
        if (ep.aiCategory === undefined) ep.aiCategory = null;
        if (ep.aiSeries === undefined) ep.aiSeries = null;
      });
    });

    this.version(7).stores({
      episodes:
        "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, archiveIdentifier, lastPlayedAt, aiStatus, favoritedAt, flaggedAt, aiCategory, aiSeries, *aiTags",
      scanSessions: "++id, status, startedAt",
      userPrefs: "++id, &key",
      playlists: "++id, name, createdAt",
      history: "++id, episodeId, timestamp",
      bookmarks: "++id, episodeId, position, createdAt",
    });

    // v8: no schema change. Rewrites the file-less `archive:{identifier}` keys
    // the old catalog scraper wrote to the canonical
    // `archive:{identifier}:{fileName}`, merging any that collide with an
    // existing row without dropping user data (HD-025, ./legacy-keys.ts).
    // Dexie runs this once, and only for databases created before v8.
    this.version(8).stores({
      episodes:
        "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, archiveIdentifier, lastPlayedAt, aiStatus, favoritedAt, flaggedAt, aiCategory, aiSeries, *aiTags",
      scanSessions: "++id, status, startedAt",
      userPrefs: "++id, &key",
      playlists: "++id, name, createdAt",
      history: "++id, episodeId, timestamp",
      bookmarks: "++id, episodeId, position, createdAt",
    }).upgrade((tx) =>
      migrateLegacyScraperKeys({
        episodes: tx.table("episodes"),
        history: tx.table("history"),
        bookmarks: tx.table("bookmarks"),
        playlists: tx.table("playlists"),
        userPrefs: tx.table("userPrefs"),
      }),
    );

    // v9 (HD-016): playback position and last-played move to their own table,
    // so the player's position saves — every 30 s while playing, and on every
    // pause and page hide — stop waking every live query over `episodes`.
    //
    // Keyed by `fileHash`, the episode's identity, not the numeric id: that is
    // what Export/Import travel by, the dedup/heal/legacy-key merges retire ids
    // but not hashes, and the unload flush can write it without reading the
    // episode row first. `lastPlayedAt` is indexed for "Recently played".
    //
    // The upgrade COPIES; the old fields stay on the episode rows, untouched
    // (./progress-migration.ts says why). The episodes' `lastPlayedAt` index is
    // dropped — no row changes — so a leftover query against it fails loudly
    // instead of reading positions frozen at the upgrade.
    this.version(9).stores({
      episodes:
        "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, archiveIdentifier, aiStatus, favoritedAt, flaggedAt, aiCategory, aiSeries, *aiTags",
      scanSessions: "++id, status, startedAt",
      userPrefs: "++id, &key",
      playlists: "++id, name, createdAt",
      history: "++id, episodeId, timestamp",
      bookmarks: "++id, episodeId, position, createdAt",
      progress: "fileHash, lastPlayedAt",
    }).upgrade((tx) => copyLegacyProgress(tx.table("episodes"), tx.table("progress")));
  }
}

export const db = new HighDesertDB();

// Ask for persistent storage after the listener's first real write (HD-010).
installPersistRequest(db);

export async function getPreference(
  key: string
): Promise<string | undefined> {
  const pref = await db.userPrefs.where("key").equals(key).first();
  return pref?.value;
}

/** Remove one preference. Absent is fine. */
export async function deletePreference(key: string): Promise<void> {
  await db.userPrefs.where("key").equals(key).delete();
}

/**
 * Upsert one preference, atomically (HD-040). The primary key is `++id`, not
 * `key`, so a single `put` cannot do it — the read and the write share one rw
 * transaction instead. They used to be two, so two writers of the same key
 * (the volume slider, the queue saver) could both read "absent" and both
 * `add`, and the second failed the `&key` unique index with a ConstraintError.
 * Inside a caller's transaction that includes `userPrefs` (deleteEpisode,
 * clearLibrary, the seed) this joins it rather than opening its own.
 */
export async function setPreference(
  key: string,
  value: string
): Promise<void> {
  await db.transaction("rw", db.userPrefs, async () => {
    const existing = await db.userPrefs.where("key").equals(key).first();
    if (existing) {
      await db.userPrefs.update(existing.id!, { value });
    } else {
      await db.userPrefs.add({ key, value });
    }
  });
}
