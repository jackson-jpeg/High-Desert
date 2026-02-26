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
    
    // Hook into Dexie's transaction events for performance monitoring
    this.on('ready', () => {
      this.use({
        stack: 'dbcore',
        name: 'PerformanceMonitor',
        create: (downlevelDB) => ({
          ...downlevelDB,
          table: (tableName) => {
            const table = downlevelDB.table(tableName);
            return {
              ...table,
              mutate: (req) => {
                const markName = `db:${tableName}:${req.type}:start`;
                performance.mark(markName);
                const result = table.mutate(req);
                if (result && typeof result.then === 'function') {
                  return result.finally(() => {
                    performance.mark(`${markName.replace(':start', ':end')}`);
                    performance.measure(
                      `db:${tableName}:${req.type}`,
                      markName,
                      `${markName.replace(':start', ':end')}`
                    );
                  });
                } else {
                  performance.mark(`${markName.replace(':start', ':end')}`);
                  performance.measure(
                    `db:${tableName}:${req.type}`,
                    markName,
                    `${markName.replace(':start', ':end')}`
                  );
                  return result;
                }
              },
              query: (req) => {
                const markName = `db:${tableName}:query:start`;
                performance.mark(markName);
                const result = table.query(req);
                if (result && typeof result.then === 'function') {
                  return result.finally(() => {
                    performance.mark(`${markName.replace(':start', ':end')}`);
                    performance.measure(
                      `db:${tableName}:query`,
                      markName,
                      `${markName.replace(':start', ':end')}`
                    );
                  });
                } else {
                  performance.mark(`${markName.replace(':start', ':end')}`);
                  performance.measure(
                    `db:${tableName}:query`,
                    markName,
                    `${markName.replace(':start', ':end')}`
                  );
                  return result;
                }
              }
            };
          }
        })
      });
    });

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
        "++id, fileHash, airDate, guestName, showType, fileName, scanSessionId, createdAt, archiveIdentifier, lastPlayedAt, aiStatus, favoritedAt, aiCategory, aiSeries, aiConfidence, *aiTags, *moodTags",
      scanSessions: "++id, status, startedAt",
      userPrefs: "++id, &key",
      playlists: "++id, name, createdAt",
      history: "++id, episodeId, timestamp",
      bookmarks: "++id, episodeId, position, createdAt",
    }).upgrade((tx) => {
      return tx.table("episodes").toCollection().modify((ep) => {
        if (ep.aiConfidence === undefined) ep.aiConfidence = null;
        if (ep.moodTags === undefined) ep.moodTags = [];
      });
    });
  }
}

export const db = new HighDesertDB();

export async function getPreference(
  key: string
): Promise<string | undefined> {
  performance.mark(`getPreference:${key}:start`);
  const pref = await db.userPrefs.where("key").equals(key).first();
  performance.mark(`getPreference:${key}:end`);
  performance.measure(`getPreference:${key}`, `getPreference:${key}:start`, `getPreference:${key}:end`);
  return pref?.value;
}

export async function setPreference(key: string, value: string): Promise<void> {
  performance.mark(`setPreference:${key}:start`);
  await db.userPrefs.put({ key, value });
  performance.mark(`setPreference:${key}:end`);
  performance.measure(`setPreference:${key}`, `setPreference:${key}:start`, `setPreference:${key}:end`);
}

export async function getEpisode(id: number): Promise<Episode | undefined> {
  performance.mark(`getEpisode:${id}:start`);
  const ep = await db.episodes.get(id);
  performance.mark(`getEpisode:${id}:end`);
  performance.measure(`getEpisode:${id}`, `getEpisode:${id}:start`, `getEpisode:${id}:end`);
  return ep;
}

export async function saveEpisode(episode: Episode): Promise<number> {
  performance.mark(`saveEpisode:${episode.id || 'new'}:start`);
  const id = await db.episodes.put(episode);
  performance.mark(`saveEpisode:${episode.id || 'new'}:end`);
  performance.measure(`saveEpisode:${episode.id || 'new'}`, `saveEpisode:${episode.id || 'new'}:start`, `saveEpisode:${episode.id || 'new'}:end`);
  return id;
}

export async function deleteEpisode(id: number): Promise<void> {
  performance.mark(`deleteEpisode:${id}:start`);
  await db.episodes.delete(id);
  performance.mark(`deleteEpisode:${id}:end`);
  performance.measure(`deleteEpisode:${id}`, `deleteEpisode:${id}:start`, `deleteEpisode:${id}:end`);
}

export async function getAllEpisodes(): Promise<Episode[]> {
  performance.mark(`getAllEpisodes:start`);
  const eps = await db.episodes.toArray();
  performance.mark(`getAllEpisodes:end`);
  performance.measure(`getAllEpisodes`, `getAllEpisodes:start`, `getAllEpisodes:end`);
  return eps;
}

export async function getRecentEpisodes(limit: number = 50): Promise<Episode[]> {
  performance.mark(`getRecentEpisodes:${limit}:start`);
  const eps = await db.episodes.orderBy('createdAt').reverse().limit(limit).toArray();
  performance.mark(`getRecentEpisodes:${limit}:end`);
  performance.measure(`getRecentEpisodes:${limit}`, `getRecentEpisodes:${limit}:start`, `getRecentEpisodes:${limit}:end`);
  return eps;
}

export async function getEpisodesBySeries(seriesName: string): Promise<Episode[]> {
  performance.mark(`getEpisodesBySeries:${seriesName}:start`);
  const eps = await db.episodes.where('showType').equals(seriesName).toArray();
  performance.mark(`getEpisodesBySeries:${seriesName}:end`);
  performance.measure(`getEpisodesBySeries:${seriesName}`, `getEpisodesBySeries:${seriesName}:start`, `getEpisodesBySeries:${seriesName}:end`);
  return eps;
}

export async function getSeries(): Promise<string[]> {
  performance.mark(`getSeries:start`);
  const series = await db.episodes.orderBy('showType').uniqueKeys();
  performance.mark(`getSeries:end`);
  performance.measure(`getSeries`, `getSeries:start`, `getSeries:end`);
  return series as string[];
}

export async function saveSeries(seriesName: string): Promise<void> {
  performance.mark(`saveSeries:${seriesName}:start`);
  // Series are implicit via episodes; no-op or future extension
  performance.mark(`saveSeries:${seriesName}:end`);
  performance.measure(`saveSeries:${seriesName}`, `saveSeries:${seriesName}:start`, `saveSeries:${seriesName}:end`);
}

export async function deleteSeries(seriesName: string): Promise<void> {
  performance.mark(`deleteSeries:${seriesName}:start`);
  await db.episodes.where('showType').equals(seriesName).delete();
  performance.mark(`deleteSeries:${seriesName}:end`);
  performance.measure(`deleteSeries:${seriesName}`, `deleteSeries:${seriesName}:start`, `deleteSeries:${seriesName}:end`);
}

export async function getAllSeries(): Promise<string[]> {
  performance.mark(`getAllSeries:start`);
  const series = await getSeries();
  performance.mark(`getAllSeries:end`);
  performance.measure(`getAllSeries`, `getAllSeries:start`, `getAllSeries:end`);
  return series;
}'db:getPreference:start');
  try {
    const pref = await db.userPrefs.where("key").equals(key).first();
    return pref?.value;
  } finally {
    performance.mark('db:getPreference:end');
    performance.measure('db:getPreference', 'db:getPreference:start', 'db:getPreference:end');
  }
}

export async function setPreference(
  key: string,
  value: string
): Promise<void> {
  performance.mark('db:setPreference:start');
  try {
    const existing = await db.userPrefs.where("key").equals(key).first();
    if (existing) {
      await db.userPrefs.update(existing.id!, { value });
    } else {
      await db.userPrefs.add({ key, value });
    }
  } finally {
    performance.mark('db:setPreference:end');
    performance.measure('db:setPreference', 'db:setPreference:start', 'db:setPreference:end');
  }
}
