import Dexie, { type EntityTable } from "dexie";
import type { Episode, ScanSession, UserPrefs } from "./schema";

export type { Episode, ScanSession, UserPrefs };

class HighDesertDB extends Dexie {
  episodes!: EntityTable<Episode, "id">;
  scanSessions!: EntityTable<ScanSession, "id">;
  userPrefs!: EntityTable<UserPrefs, "id">;

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
