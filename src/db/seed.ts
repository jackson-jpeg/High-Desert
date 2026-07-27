import { db, getPreference, setPreference } from "./index";
import { toast } from "@/stores/toast-store";
import type { Episode } from "./schema";

/**
 * Bump to force every user to re-run reconcileLibrary() once.
 * Only do this when the shipped catalog actually changes.
 */
export const SEED_VERSION = "2026-07-27-a";

const RECONCILED_PREF = "seed-reconciled";
const TOMBSTONE_PREF = "deleted-hashes";
const MAX_TOMBSTONES = 2000;

/** Stable identity for a catalog row. Matches what both import paths build. */
export function seedFileHash(row: Record<string, unknown>): string {
  return (row.fileHash as string) ?? `archive:${row.archiveIdentifier ?? row.fileName}`;
}

/** Map a raw seed row onto an Episode. Shared by the initial seed and reconcile. */
export function toEpisodeRow(ep: Record<string, unknown>, now: number): Omit<Episode, "id"> {
  return {
    fileHash: seedFileHash(ep),
    filePath: (ep.filePath as string) ?? (ep.sourceUrl as string) ?? "",
    fileName: (ep.fileName as string) ?? "",
    fileSize: (ep.fileSize as number) ?? 0,
    title: ep.title as string | undefined,
    artist: ep.artist as string | undefined,
    airDate: ep.airDate as string | undefined,
    guestName: ep.guestName as string | undefined,
    showType: ep.showType as Episode["showType"],
    topic: ep.topic as string | undefined,
    description: ep.description as string | undefined,
    duration: ep.duration as number | undefined,
    format: ep.format as string | undefined,
    source: (ep.source as Episode["source"]) ?? "archive",
    sourceUrl: ep.sourceUrl as string | undefined,
    archiveIdentifier: ep.archiveIdentifier as string | undefined,
    aiSummary: ep.aiSummary as string | undefined,
    aiTags: ep.aiTags as string[] | undefined,
    aiCategory: ep.aiCategory as string | undefined,
    aiSeries: ep.aiSeries as string | undefined,
    aiSeriesPart: ep.aiSeriesPart as number | undefined,
    aiNotable: ep.aiNotable as boolean | undefined,
    aiStatus: (ep.aiStatus as Episode["aiStatus"]) ?? "completed",
    favoritedAt: ep.favoritedAt ? (ep.favoritedAt as number) : undefined,
    rating: ep.rating as number | undefined,
    createdAt: now,
    updatedAt: now,
  };
}

async function fetchSeedRows(): Promise<Record<string, unknown>[] | null> {
  const res = await fetch("/seed/library.json");
  if (!res.ok) return null;
  const data = await res.json();
  const raw: Record<string, unknown>[] = Array.isArray(data) ? data : data.episodes;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw;
}

/**
 * On first visit (empty DB), fetch the pre-built seed catalog from /seed/library.json
 * and populate the local IndexedDB. Subsequent visits skip this entirely.
 *
 * Module-level guard prevents React Strict Mode double-invocation race condition.
 */
let _seedPromise: Promise<boolean> | null = null;

export function seedLibraryIfEmpty(): Promise<boolean> {
  if (!_seedPromise) _seedPromise = _seedLibraryIfEmpty();
  return _seedPromise;
}

async function _seedLibraryIfEmpty(): Promise<boolean> {
  const count = await db.episodes.count();
  if (count > 0) return false;

  try {
    const res = await fetch("/seed/library.json");
    if (!res.ok) {
      toast.error("Failed to load catalog — try refreshing");
      return false;
    }

    const data = await res.json();
    const raw: Record<string, unknown>[] = Array.isArray(data) ? data : data.episodes;
    if (!Array.isArray(raw) || raw.length === 0) return false;

    const now = Date.now();
    const episodes = raw.map((ep) => toEpisodeRow(ep, now));

    // All-or-nothing: a partial seed would be permanent, because the count>0 guard
    // above stops this from ever running again.
    await db.transaction("rw", db.episodes, db.playlists, db.userPrefs, async () => {
      await db.episodes.bulkAdd(episodes as Episode[]);

      // Restore playlists from seed if present
      if (data.playlists && Array.isArray(data.playlists)) {
        // We need to map fileHash references back to new IDs
        const allEps = await db.episodes.toArray();
        const hashToId = new Map(allEps.map((e) => [e.fileHash, e.id!]));

        for (const pl of data.playlists as { name: string; description?: string; episodeHashes: string[] }[]) {
          const episodeIds = (pl.episodeHashes ?? [])
            .map((h: string) => hashToId.get(h))
            .filter(Boolean) as number[];
          if (episodeIds.length > 0 || pl.name) {
            await db.playlists.add({
              name: pl.name,
              description: pl.description,
              episodeIds,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
      }

      // A fresh seed is by definition already reconciled.
      const existing = await db.userPrefs.where("key").equals(RECONCILED_PREF).first();
      if (existing) await db.userPrefs.update(existing.id!, { value: SEED_VERSION });
      else await db.userPrefs.add({ key: RECONCILED_PREF, value: SEED_VERSION });
    });

    toast.success(`Loaded ${episodes.length.toLocaleString()} episodes from catalog`);
    return true;
  } catch (err) {
    console.warn("[seed] Failed to load seed catalog:", err);
    toast.error("Failed to load catalog — try refreshing");
    return false;
  }
}

/**
 * Decide which catalog rows are missing locally. Pure — unit tested without IndexedDB.
 *
 * Returns only rows whose fileHash is absent locally AND not deliberately deleted.
 * Callers must never do anything with the result except bulkAdd it.
 */
export function planReconcile(
  seedRows: Record<string, unknown>[],
  localHashes: Set<string>,
  tombstones: Set<string>,
): Record<string, unknown>[] {
  return seedRows.filter((row) => {
    const hash = seedFileHash(row);
    return !!hash && !localHashes.has(hash) && !tombstones.has(hash);
  });
}

/** Record a deliberate deletion so reconcile won't resurrect it. */
export async function addTombstone(fileHash: string): Promise<void> {
  if (!fileHash) return;
  try {
    const existing = JSON.parse((await getPreference(TOMBSTONE_PREF)) ?? "[]") as string[];
    if (existing.includes(fileHash)) return;
    existing.push(fileHash);
    // Keep the most recent entries only
    const capped = existing.slice(-MAX_TOMBSTONES);
    await setPreference(TOMBSTONE_PREF, JSON.stringify(capped));
  } catch {
    // Tombstones are best-effort — never block a delete on this
  }
}

/** Clear tombstones (used when the user clears the whole library). */
export async function clearTombstones(): Promise<void> {
  try {
    await setPreference(TOMBSTONE_PREF, "[]");
    await setPreference(RECONCILED_PREF, "");
  } catch {
    // best-effort
  }
}

/**
 * Restore catalog episodes that are missing from a user's library.
 *
 * This exists because a dedup bug deleted up to 1,312 of 1,313 episodes for some
 * users. It is deliberately conservative:
 *
 *   - Runs at most once per user per SEED_VERSION (gate checked BEFORE any fetch).
 *   - The ONLY write to db.episodes is bulkAdd() of rows whose fileHash provably
 *     does not exist locally, so existing favorites / ratings / playback positions
 *     cannot be touched.
 *   - Deliberately deleted episodes are remembered as tombstones and stay deleted.
 *
 * Returns the number of episodes restored.
 */
export async function reconcileLibrary(): Promise<number> {
  try {
    const count = await db.episodes.count();
    if (count === 0) return 0; // fresh install — seeding handles this

    // Gate before the network call, so healthy users fetch the catalog at most once ever.
    if ((await getPreference(RECONCILED_PREF)) === SEED_VERSION) return 0;

    const raw = await fetchSeedRows();
    if (!raw) return 0;

    // Index-only scan — does not deserialize episode rows.
    const localHashes = new Set(
      (await db.episodes.orderBy("fileHash").uniqueKeys()) as string[],
    );
    let tombstones = new Set<string>();
    try {
      tombstones = new Set(JSON.parse((await getPreference(TOMBSTONE_PREF)) ?? "[]") as string[]);
    } catch {
      // ignore malformed tombstone data
    }

    const missing = planReconcile(raw, localHashes, tombstones);

    if (missing.length === 0) {
      await setPreference(RECONCILED_PREF, SEED_VERSION);
      return 0;
    }

    const now = Date.now();
    const rows = missing.map((r) => toEpisodeRow(r, now));

    await db.transaction("rw", db.episodes, db.userPrefs, async () => {
      await db.episodes.bulkAdd(rows as Episode[]);
      const existing = await db.userPrefs.where("key").equals(RECONCILED_PREF).first();
      if (existing) await db.userPrefs.update(existing.id!, { value: SEED_VERSION });
      else await db.userPrefs.add({ key: RECONCILED_PREF, value: SEED_VERSION });
    });

    console.info(`[seed] reconcile restored ${rows.length} episodes`);
    return rows.length;
  } catch (err) {
    console.warn("[seed] reconcile failed:", err);
    return 0;
  }
}

/**
 * Export the full library as a compact JSON seed file.
 * Strips per-device fields (playback position, play count, timestamps).
 */
export async function exportLibrarySeed(): Promise<void> {
  const all = await db.episodes.toArray();
  if (all.length === 0) {
    toast.error("Library is empty — nothing to export");
    return;
  }

  // Keep only catalog-relevant fields, drop per-device state
  const seed = all.map((ep) => {
    const obj: Record<string, unknown> = {};
    if (ep.fileHash) obj.fileHash = ep.fileHash;
    if (ep.fileName) obj.fileName = ep.fileName;
    if (ep.filePath) obj.filePath = ep.filePath;
    if (ep.fileSize) obj.fileSize = ep.fileSize;
    if (ep.title) obj.title = ep.title;
    if (ep.artist) obj.artist = ep.artist;
    if (ep.airDate) obj.airDate = ep.airDate;
    if (ep.guestName) obj.guestName = ep.guestName;
    if (ep.showType) obj.showType = ep.showType;
    if (ep.topic) obj.topic = ep.topic;
    if (ep.description) obj.description = ep.description;
    if (ep.duration) obj.duration = ep.duration;
    if (ep.format) obj.format = ep.format;
    if (ep.source) obj.source = ep.source;
    if (ep.sourceUrl) obj.sourceUrl = ep.sourceUrl;
    if (ep.archiveIdentifier) obj.archiveIdentifier = ep.archiveIdentifier;
    if (ep.aiSummary) obj.aiSummary = ep.aiSummary;
    if (ep.aiTags?.length) obj.aiTags = ep.aiTags;
    if (ep.aiCategory) obj.aiCategory = ep.aiCategory;
    if (ep.aiSeries) obj.aiSeries = ep.aiSeries;
    if (ep.aiSeriesPart) obj.aiSeriesPart = ep.aiSeriesPart;
    if (ep.aiNotable) obj.aiNotable = ep.aiNotable;
    if (ep.aiStatus) obj.aiStatus = ep.aiStatus;
    // v2: include favorites + ratings
    if (ep.favoritedAt) obj.favoritedAt = ep.favoritedAt;
    if (ep.rating) obj.rating = ep.rating;
    return obj;
  });

  // v2: include playlists (reference episodes by fileHash for portability)
  const playlists = await db.playlists.toArray();
  const idToHash = new Map(all.map((ep) => [ep.id!, ep.fileHash]));
  const playlistSeed = playlists.map((pl) => ({
    name: pl.name,
    description: pl.description,
    episodeHashes: pl.episodeIds
      .map((id) => idToHash.get(id))
      .filter(Boolean),
  }));

  // Wrap in envelope for v2 format
  const envelope = {
    version: 2,
    episodes: seed,
    ...(playlistSeed.length > 0 ? { playlists: playlistSeed } : {}),
  };

  // Compact JSON (no pretty print) — gzips well on CDN
  const json = JSON.stringify(envelope);
  const blob = new Blob([json], { type: "application/json" });
  const sizeMB = (blob.size / 1024 / 1024).toFixed(1);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "library.json";
  a.click();
  URL.revokeObjectURL(url);

  toast.success(`Exported ${all.length.toLocaleString()} episodes (${sizeMB} MB) — place in public/seed/`);
}
