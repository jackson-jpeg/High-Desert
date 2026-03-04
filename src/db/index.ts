import Dexie, { type EntityTable } from "dexie";
import type { Episode, ScanSession, UserPrefs, Playlist, HistoryEntry, Bookmark } from "./schema";

export type { Episode, ScanSession, UserPrefs, Playlist, HistoryEntry, Bookmark };

class HighDesertDB extends Dexie {
  episodes!: EntityTable<Episode, "id">;
  scanSessions!: EntityTable<ScanSession, "id">;
  userPrefs!: EntityTable<UserPrefs, "id">;
  playlists!: EntityTable<Playlist, "id">;
  history!: EntityTable<HistoryEntry, "id">;
  bookmarks!: EntityTable<Bookmark, "id">;

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
  }
}

export const db = new HighDesertDB();

export async function getPreference(
  key: string
): Promise<string | undefined> {
  const pref = await db.userPrefs.where("key").equals(key).first();
  return pref?.value;
}

export async function setPreference(
  key: string,
  value: string
): Promise<void> {
  const existing = await db.userPrefs.where("key").equals(key).first();
  if (existing) {
    await db.userPrefs.update(existing.id!, { value });
  } else {
    await db.userPrefs.add({ key, value });
  }
}
