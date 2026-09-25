/**
 * "Export my data" / "Import my data" (HD-010).
 *
 * Everything a listener owns lives only in this browser's IndexedDB. The
 * browser may evict it (see src/db/persist.ts), and it does not follow them to
 * another device. This is the one copy they can hold themselves.
 *
 * **Episodes are identified by `fileHash`, never by the numeric `id`.** The id
 * is an auto-increment local to one profile: a fresh profile seeds the same
 * catalog under different ids, so a file keyed by id would attach every
 * favourite to the wrong show. `fileHash` is the identity key the seeder and
 * both import paths build identically (CLAUDE.md, "Data safety").
 *
 * **Import only ever adds.** It is a merge, not a restore:
 *
 *   - nothing is deleted, and no table is cleared;
 *   - a field the profile already has is kept (its rating, its favourite, its
 *     flag); a field it lacks is filled from the file;
 *   - where both have a playback position, the more recent listen wins, and
 *     play counts take the larger — conflicts resolve toward more data;
 *   - history and bookmarks are added unless an identical one is already
 *     there, so importing the same file twice changes nothing the second time;
 *   - a playlist whose name already exists gains the file's episodes rather
 *     than being duplicated or replaced;
 *   - episodes the file names but this library lacks are counted and skipped.
 *
 * And it runs in **one read-write transaction** across every table it
 * touches: a failure part-way leaves the profile exactly as it was.
 *
 * A file that is malformed, of another format, or from a newer version is
 * refused whole, before anything is written — `parseUserData` validates every
 * entry, so the transaction never sees a value it would have to guess about.
 */
import { db } from "@/db";
import { requestPersistentStorage } from "@/db/persist";
import type { Episode, HistoryEntry, Bookmark, Playlist, Progress } from "@/db/schema";

export const USER_DATA_FORMAT = "high-desert-user-data";
export const USER_DATA_VERSION = 1;

/**
 * Preferences worth carrying to another profile. An allowlist: the others are
 * bookkeeping for *this* profile (the seed version, reconcile tombstones, the
 * queue's local ids, whether persist() was asked) and would be wrong anywhere
 * else.
 */
export const PORTABLE_PREFS = [
  "volume",
  "startup-sound",
  "viz-mode",
  "text-scale",
  "library-sort",
  "facets-open",
  "explore-collapsed",
  "radio-hint-dismissed",
  "swipe-hint-dismissed",
] as const;

export interface ExportedEpisode {
  fileHash: string;
  favoritedAt?: number;
  rating?: number;
  flaggedAt?: number;
  playbackPosition?: number;
  lastPlayedAt?: number;
  playCount?: number;
}
export interface ExportedHistory {
  fileHash: string;
  timestamp: number;
  duration: number;
  episodeTitle?: string;
  guestName?: string;
}
export interface ExportedBookmark {
  fileHash: string;
  position: number;
  label: string;
  createdAt: number;
}
export interface ExportedPlaylist {
  name: string;
  description?: string;
  episodeHashes: string[];
  createdAt: number;
  updatedAt: number;
}
export interface UserDataFile {
  format: typeof USER_DATA_FORMAT;
  version: number;
  exportedAt: string;
  episodes: ExportedEpisode[];
  history: ExportedHistory[];
  bookmarks: ExportedBookmark[];
  playlists: ExportedPlaylist[];
  prefs: Record<string, string>;
}

// ─── Export ────────────────────────────────────────────────────────────────

function hasPersonalData(ep: Episode, progress: Progress | undefined): boolean {
  return !!(ep.favoritedAt || ep.rating || ep.flaggedAt || (progress?.playbackPosition ?? 0) > 0 || (progress?.lastPlayedAt ?? 0) > 0 || (ep.playCount ?? 0) > 0);
}

/** Read the visitor's own data into the portable shape, in one consistent snapshot. */
export async function buildUserDataExport(now: Date = new Date()): Promise<UserDataFile> {
  return db.transaction("r", [db.episodes, db.history, db.bookmarks, db.playlists, db.userPrefs, db.progress], async () => {
    const [episodes, history, bookmarks, playlists, prefs, progressRows] = await Promise.all([
      db.episodes.toArray(),
      db.history.toArray(),
      db.bookmarks.toArray(),
      db.playlists.toArray(),
      db.userPrefs.where("key").anyOf([...PORTABLE_PREFS]).toArray(),
      db.progress.toArray(),
    ]);
    const hashOf = new Map(episodes.map((ep) => [ep.id!, ep.fileHash]));
    // Position and last-played live in `progress` since v9 (HD-016). The file
    // format is unchanged: they still travel on the episode's row.
    const progressOf = new Map(progressRows.map((p) => [p.fileHash, p]));

    const out: UserDataFile = {
      format: USER_DATA_FORMAT,
      version: USER_DATA_VERSION,
      exportedAt: now.toISOString(),
      episodes: [],
      history: [],
      bookmarks: [],
      playlists: [],
      prefs: {},
    };

    for (const ep of episodes) {
      const progress = progressOf.get(ep.fileHash);
      if (!ep.fileHash || !hasPersonalData(ep, progress)) continue;
      const row: ExportedEpisode = { fileHash: ep.fileHash };
      if (ep.favoritedAt) row.favoritedAt = ep.favoritedAt;
      if (ep.rating) row.rating = ep.rating;
      if (ep.flaggedAt) row.flaggedAt = ep.flaggedAt;
      if ((progress?.playbackPosition ?? 0) > 0) row.playbackPosition = progress!.playbackPosition;
      if ((progress?.lastPlayedAt ?? 0) > 0) row.lastPlayedAt = progress!.lastPlayedAt;
      if ((ep.playCount ?? 0) > 0) row.playCount = ep.playCount;
      out.episodes.push(row);
    }
    // Rows whose episode no longer exists are orphans; they have no hash to travel by.
    for (const h of history) {
      const fileHash = hashOf.get(h.episodeId);
      if (!fileHash) continue;
      out.history.push({
        fileHash,
        timestamp: h.timestamp,
        duration: h.duration,
        ...(h.episodeTitle ? { episodeTitle: h.episodeTitle } : {}),
        ...(h.guestName ? { guestName: h.guestName } : {}),
      });
    }
    for (const b of bookmarks) {
      const fileHash = hashOf.get(b.episodeId);
      if (!fileHash) continue;
      out.bookmarks.push({ fileHash, position: b.position, label: b.label, createdAt: b.createdAt });
    }
    for (const pl of playlists) {
      out.playlists.push({
        name: pl.name,
        ...(pl.description ? { description: pl.description } : {}),
        episodeHashes: pl.episodeIds.map((id) => hashOf.get(id)).filter((h): h is string => !!h),
        createdAt: pl.createdAt,
        updatedAt: pl.updatedAt,
      });
    }
    for (const p of prefs) out.prefs[p.key] = p.value;
    return out;
  });
}

/** `high-desert-my-data-2026-09-22.json` */
export function userDataFileName(now: Date = new Date()): string {
  return `high-desert-my-data-${now.toISOString().slice(0, 10)}.json`;
}

// ─── Validation ────────────────────────────────────────────────────────────

export type ParseResult = { ok: true; data: UserDataFile } | { ok: false; reason: string };

/** Generous ceilings: a file past these is not something this app wrote. */
const MAX_ROWS = 200_000;
const MAX_TEXT = 2_000;

class Invalid extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown, where: string, optional = false): string | undefined {
  if (v === undefined && optional) return undefined;
  if (typeof v !== "string" || v.length > MAX_TEXT) throw new Invalid(`${where} is not valid text`);
  return v;
}
function num(v: unknown, where: string, optional = false): number | undefined {
  if (v === undefined && optional) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Invalid(`${where} is not a valid number`);
  return v;
}
function list(v: unknown, where: string): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_ROWS) throw new Invalid(`${where} is not a list`);
  return v;
}
function hash(v: unknown, where: string): string {
  const h = str(v, where)!;
  if (!h) throw new Invalid(`${where} is empty`);
  return h;
}
/** Drop undefined keys, so a parsed row compares and stores like an exported one. */
function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/**
 * Validate a file's text. Refuses the whole file on the first problem: a
 * partial import of a file we do not understand is worse than none.
 */
export function parseUserData(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "This file isn't valid JSON." };
  }
  if (!isObj(raw) || raw.format !== USER_DATA_FORMAT) {
    return { ok: false, reason: "This isn't a High Desert data export." };
  }
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) {
    return { ok: false, reason: "This export has no valid version." };
  }
  if (raw.version > USER_DATA_VERSION) {
    return { ok: false, reason: "This export is from a newer version of High Desert. Reload the page to update, then try again." };
  }

  try {
    const episodes = list(raw.episodes, "episodes").map((e, i) => {
      const w = `episodes[${i}]`;
      if (!isObj(e)) throw new Invalid(`${w} is not an object`);
      const rating = num(e.rating, `${w}.rating`, true);
      if (rating !== undefined && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
        throw new Invalid(`${w}.rating must be 1–5`);
      }
      return clean<ExportedEpisode>({
        fileHash: hash(e.fileHash, `${w}.fileHash`),
        favoritedAt: num(e.favoritedAt, `${w}.favoritedAt`, true),
        rating,
        flaggedAt: num(e.flaggedAt, `${w}.flaggedAt`, true),
        playbackPosition: num(e.playbackPosition, `${w}.playbackPosition`, true),
        lastPlayedAt: num(e.lastPlayedAt, `${w}.lastPlayedAt`, true),
        playCount: num(e.playCount, `${w}.playCount`, true),
      });
    });
    const history = list(raw.history, "history").map((h, i) => {
      const w = `history[${i}]`;
      if (!isObj(h)) throw new Invalid(`${w} is not an object`);
      return clean<ExportedHistory>({
        fileHash: hash(h.fileHash, `${w}.fileHash`),
        timestamp: num(h.timestamp, `${w}.timestamp`)!,
        duration: num(h.duration, `${w}.duration`)!,
        episodeTitle: str(h.episodeTitle, `${w}.episodeTitle`, true),
        guestName: str(h.guestName, `${w}.guestName`, true),
      });
    });
    const bookmarks = list(raw.bookmarks, "bookmarks").map((b, i) => {
      const w = `bookmarks[${i}]`;
      if (!isObj(b)) throw new Invalid(`${w} is not an object`);
      return {
        fileHash: hash(b.fileHash, `${w}.fileHash`),
        position: num(b.position, `${w}.position`)!,
        label: str(b.label, `${w}.label`)!,
        createdAt: num(b.createdAt, `${w}.createdAt`)!,
      };
    });
    const playlists = list(raw.playlists, "playlists").map((p, i) => {
      const w = `playlists[${i}]`;
      if (!isObj(p)) throw new Invalid(`${w} is not an object`);
      const name = str(p.name, `${w}.name`)!;
      if (!name.trim()) throw new Invalid(`${w}.name is empty`);
      return clean<ExportedPlaylist>({
        name,
        description: str(p.description, `${w}.description`, true),
        episodeHashes: list(p.episodeHashes, `${w}.episodeHashes`).map((h, j) => hash(h, `${w}.episodeHashes[${j}]`)),
        createdAt: num(p.createdAt, `${w}.createdAt`)!,
        updatedAt: num(p.updatedAt, `${w}.updatedAt`)!,
      });
    });
    const prefs: Record<string, string> = {};
    if (raw.prefs !== undefined) {
      if (!isObj(raw.prefs)) throw new Invalid("prefs is not an object");
      for (const [k, v] of Object.entries(raw.prefs)) {
        // Unknown keys are ignored rather than refused: a later version may
        // carry more settings, and they are not this version's to apply.
        if (!(PORTABLE_PREFS as readonly string[]).includes(k)) continue;
        prefs[k] = str(v, `prefs.${k}`)!;
      }
    }
    return {
      ok: true,
      data: {
        format: USER_DATA_FORMAT,
        version: raw.version,
        exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
        episodes, history, bookmarks, playlists, prefs,
      },
    };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, reason: `This file is damaged (${err.message}).` };
    throw err;
  }
}

// ─── Import ────────────────────────────────────────────────────────────────

/** What an import will change — shown in the confirm dialog, and returned by the import itself. */
export interface ImportSummary {
  favourites: number;
  ratings: number;
  flags: number;
  positions: number;
  history: number;
  bookmarks: number;
  playlistsCreated: number;
  playlistsExtended: number;
  prefs: number;
  /** Episodes named in the file that this library does not have. */
  unmatched: number;
}

interface Plan {
  summary: ImportSummary;
  episodeChanges: Map<number, Partial<Episode>>;
  /** Progress entries to merge, by fileHash (the `progress` table, HD-016). */
  progressChanges: Map<string, Omit<Progress, "fileHash">>;
  newHistory: Omit<HistoryEntry, "id">[];
  newBookmarks: Omit<Bookmark, "id">[];
  newPlaylists: Omit<Playlist, "id">[];
  extendPlaylists: Map<number, number[]>;
  newPrefs: { key: string; value: string }[];
}

const TABLES = () => [db.episodes, db.history, db.bookmarks, db.playlists, db.userPrefs, db.progress];

/** Read the profile and work out the merge. Must run inside a transaction over TABLES. */
async function plan(data: UserDataFile): Promise<Plan> {
  const summary: ImportSummary = {
    favourites: 0, ratings: 0, flags: 0, positions: 0, history: 0, bookmarks: 0,
    playlistsCreated: 0, playlistsExtended: 0, prefs: 0, unmatched: 0,
  };

  const hashes = new Set<string>([
    ...data.episodes.map((e) => e.fileHash),
    ...data.history.map((h) => h.fileHash),
    ...data.bookmarks.map((b) => b.fileHash),
    ...data.playlists.flatMap((p) => p.episodeHashes),
  ]);
  const local = await db.episodes.where("fileHash").anyOf([...hashes]).toArray();
  // fileHash is unique by design; if a profile somehow holds two rows for one
  // hash (the pre-fix dedup era), the data goes to the lowest id, the row
  // dedup would keep, rather than being written twice.
  const byHash = new Map<string, Episode>();
  for (const ep of local.sort((a, b) => a.id! - b.id!)) if (!byHash.has(ep.fileHash)) byHash.set(ep.fileHash, ep);

  const unmatched = new Set<string>();
  const idFor = (h: string): number | undefined => {
    const ep = byHash.get(h);
    if (!ep) unmatched.add(h);
    return ep?.id;
  };

  // This profile's progress for the matched episodes (HD-016: its own table).
  const localProgress = new Map(
    (await db.progress.where("fileHash").anyOf([...byHash.keys()]).toArray()).map((p) => [p.fileHash, p]),
  );

  const episodeChanges = new Map<number, Partial<Episode>>();
  const progressChanges = new Map<string, Omit<Progress, "fileHash">>();
  for (const incoming of data.episodes) {
    const ep = byHash.get(incoming.fileHash);
    if (!ep) { unmatched.add(incoming.fileHash); continue; }
    const change: Partial<Episode> = {};
    if (incoming.favoritedAt && !ep.favoritedAt) { change.favoritedAt = incoming.favoritedAt; summary.favourites++; }
    if (incoming.rating && !ep.rating) { change.rating = incoming.rating; summary.ratings++; }
    if (incoming.flaggedAt && !ep.flaggedAt) { change.flaggedAt = incoming.flaggedAt; summary.flags++; }
    // Position and last-played travel together: the position belongs to that listen.
    const mine = localProgress.get(ep.fileHash);
    const progress: Omit<Progress, "fileHash"> = {};
    if ((incoming.lastPlayedAt ?? 0) > (mine?.lastPlayedAt ?? 0)) {
      progress.lastPlayedAt = incoming.lastPlayedAt;
      if (incoming.playbackPosition !== undefined && incoming.playbackPosition !== mine?.playbackPosition) {
        progress.playbackPosition = incoming.playbackPosition;
        summary.positions++;
      }
    } else if (!mine?.playbackPosition && (incoming.playbackPosition ?? 0) > 0) {
      progress.playbackPosition = incoming.playbackPosition;
      summary.positions++;
    }
    if ((incoming.playCount ?? 0) > (ep.playCount ?? 0)) change.playCount = incoming.playCount;
    if (Object.keys(change).length > 0) episodeChanges.set(ep.id!, change);
    if (Object.keys(progress).length > 0) progressChanges.set(ep.fileHash, progress);
  }

  const newHistory: Omit<HistoryEntry, "id">[] = [];
  if (data.history.length) {
    const existing = new Set((await db.history.toArray()).map((h) => `${h.episodeId}|${h.timestamp}`));
    for (const h of data.history) {
      const episodeId = idFor(h.fileHash);
      if (episodeId === undefined) continue;
      const key = `${episodeId}|${h.timestamp}`;
      if (existing.has(key)) continue;
      existing.add(key);
      newHistory.push(clean({ episodeId, timestamp: h.timestamp, duration: h.duration, episodeTitle: h.episodeTitle, guestName: h.guestName }));
    }
  }
  summary.history = newHistory.length;

  const newBookmarks: Omit<Bookmark, "id">[] = [];
  if (data.bookmarks.length) {
    const existing = new Set((await db.bookmarks.toArray()).map((b) => `${b.episodeId}|${b.position}|${b.label}`));
    for (const b of data.bookmarks) {
      const episodeId = idFor(b.fileHash);
      if (episodeId === undefined) continue;
      const key = `${episodeId}|${b.position}|${b.label}`;
      if (existing.has(key)) continue;
      existing.add(key);
      newBookmarks.push({ episodeId, position: b.position, label: b.label, createdAt: b.createdAt });
    }
  }
  summary.bookmarks = newBookmarks.length;

  const newPlaylists: Omit<Playlist, "id">[] = [];
  const extendPlaylists = new Map<number, number[]>();
  if (data.playlists.length) {
    const byName = new Map<string, Playlist>();
    for (const pl of await db.playlists.toArray()) if (!byName.has(pl.name)) byName.set(pl.name, pl);
    for (const p of data.playlists) {
      const ids = p.episodeHashes.map(idFor).filter((id): id is number => id !== undefined);
      const mine = byName.get(p.name);
      if (!mine) {
        newPlaylists.push(clean({
          name: p.name, description: p.description, episodeIds: [...new Set(ids)],
          createdAt: p.createdAt, updatedAt: p.updatedAt,
        }));
        continue;
      }
      const current = extendPlaylists.get(mine.id!) ?? mine.episodeIds;
      const add = ids.filter((id) => !current.includes(id));
      if (add.length) extendPlaylists.set(mine.id!, [...current, ...new Set(add)]);
    }
  }
  summary.playlistsCreated = newPlaylists.length;
  summary.playlistsExtended = extendPlaylists.size;

  const newPrefs: { key: string; value: string }[] = [];
  const prefKeys = Object.keys(data.prefs);
  if (prefKeys.length) {
    const have = new Set((await db.userPrefs.where("key").anyOf(prefKeys).toArray()).map((p) => p.key));
    for (const key of prefKeys) if (!have.has(key)) newPrefs.push({ key, value: data.prefs[key] });
  }
  summary.prefs = newPrefs.length;
  summary.unmatched = unmatched.size;

  return { summary, episodeChanges, progressChanges, newHistory, newBookmarks, newPlaylists, extendPlaylists, newPrefs };
}

/** Count what importing `data` would change, without changing anything. */
export async function previewUserDataImport(data: UserDataFile): Promise<ImportSummary> {
  return db.transaction("r", TABLES(), async () => (await plan(data)).summary);
}

/** True when the import would change nothing at all. */
export function isEmptyImport(s: ImportSummary): boolean {
  return s.favourites + s.ratings + s.flags + s.positions + s.history + s.bookmarks +
    s.playlistsCreated + s.playlistsExtended + s.prefs === 0;
}

/**
 * Merge `data` into this profile, in one read-write transaction. The plan is
 * recomputed inside it, so a write made between the preview and the confirm
 * is kept rather than overwritten. Adds and fills only — see the file header.
 */
export async function importUserData(data: UserDataFile): Promise<ImportSummary> {
  const summary = await inOneTransaction(async () => {
    const p = await plan(data);
    const now = Date.now();
    for (const [id, change] of p.episodeChanges) {
      await db.episodes.update(id, { ...change, updatedAt: now });
    }
    for (const [fileHash, change] of p.progressChanges) {
      await db.progress.upsert(fileHash, change);
    }
    if (p.newHistory.length) await db.history.bulkAdd(p.newHistory as HistoryEntry[]);
    if (p.newBookmarks.length) await db.bookmarks.bulkAdd(p.newBookmarks as Bookmark[]);
    if (p.newPlaylists.length) await db.playlists.bulkAdd(p.newPlaylists as Playlist[]);
    for (const [id, episodeIds] of p.extendPlaylists) {
      await db.playlists.update(id, { episodeIds, updatedAt: now });
    }
    if (p.newPrefs.length) await db.userPrefs.bulkAdd(p.newPrefs);
    return p.summary;
  });
  // An import that only added playlists or history would not trip the write
  // observers; it is the listener's data all the same.
  void requestPersistentStorage();
  return summary;
}

/** The one read-write transaction an import runs in: all of it lands, or none. */
function inOneTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction("rw", TABLES(), fn);
}
