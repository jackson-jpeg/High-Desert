import { db, getPreference, setPreference } from "./index";
import { toast } from "@/stores/toast-store";
import type { Episode } from "./schema";
import { archiveFileHash } from "./identity";
import { withSeedLock } from "./seed-lock";

/**
 * Bump to force every user to re-run reconcileLibrary() once.
 * Only do this when the shipped catalog actually changes.
 */
export const SEED_VERSION = "2026-07-27-a";

const RECONCILED_PREF = "seed-reconciled";
const TOMBSTONE_PREF = "deleted-hashes";
const MAX_TOMBSTONES = 2000;

/**
 * Stable identity for a catalog row. Every shipped row carries its own
 * `fileHash`; the fallback builds the same canonical key as both import paths
 * (`./identity.ts`) rather than the file-less `archive:{id}` it once did, which
 * for this catalog — one collection id shared by every row — would have given
 * all 1,312 episodes the same key.
 */
export function seedFileHash(row: Record<string, unknown>): string {
  if (row.fileHash) return row.fileHash as string;
  return archiveFileHash(
    (row.archiveIdentifier as string | undefined) ?? "",
    (row.fileName as string | undefined) ?? "",
  );
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

export async function fetchSeedRows(): Promise<Record<string, unknown>[] | null> {
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
 * It is per TAB, which is why it is not the only guard: see `./seed-lock.ts`
 * for the cross-tab lock and the in-transaction recount below (HD-009).
 */
let _seedPromise: Promise<boolean> | null = null;

export function seedLibraryIfEmpty(): Promise<boolean> {
  if (!_seedPromise) _seedPromise = withSeedLock(_seedLibraryIfEmpty);
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
    let inserted = false;
    await db.transaction("rw", db.episodes, db.playlists, db.userPrefs, async () => {
      // Re-check under the write lock. The count above was read in a different
      // transaction, and between it and this one another tab (or a browser
      // without navigator.locks) may have seeded. IndexedDB serialises rw
      // transactions over `episodes`, so the answer here cannot go stale
      // before bulkAdd. Two first-visit tabs used to double the library.
      if ((await db.episodes.count()) > 0) return;
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
      inserted = true;
    });
    if (!inserted) return false;

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

/**
 * Reset tombstones and the reconcile marker (used when the user clears the
 * whole library, so the catalog re-seeds cleanly). Not best-effort: it runs
 * inside clearLibrary()'s transaction, and a failure must abort the clear
 * rather than leave tombstones hiding rows from the next seed's reconcile.
 */
export async function resetSeedMarkers(): Promise<void> {
  await setPreference(TOMBSTONE_PREF, "[]");
  await setPreference(RECONCILED_PREF, "");
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
 *
 * Holds the cross-tab seed lock (`./seed-lock.ts`) and re-checks what is missing
 * inside its write transaction, for the same reason the seed does: two tabs
 * reconciling at once would otherwise both add the same missing rows.
 */
export function reconcileLibrary(): Promise<number> {
  return withSeedLock(_reconcileLibrary);
}

async function _reconcileLibrary(): Promise<number> {
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
    let rows = missing.map((r) => toEpisodeRow(r, now));

    await db.transaction("rw", db.episodes, db.userPrefs, async () => {
      // Re-plan against what is there NOW, inside the write transaction — the
      // scan above was a separate read, and only bulkAdd-of-absent is allowed.
      const present = new Set((await db.episodes.orderBy("fileHash").uniqueKeys()) as string[]);
      rows = rows.filter((r) => !present.has(r.fileHash));
      if (rows.length > 0) await db.episodes.bulkAdd(rows as Episode[]);
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

// The admin catalog export ("Export Library Seed...") lives in ./catalog-export.ts.
