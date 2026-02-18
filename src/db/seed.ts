import { db } from "./index";
import { toast } from "@/stores/toast-store";
import type { Episode } from "./schema";

/**
 * On first visit (empty DB), fetch the pre-built seed catalog from /seed/library.json
 * and populate the local IndexedDB. Subsequent visits skip this entirely.
 */
export async function seedLibraryIfEmpty(): Promise<boolean> {
  const count = await db.episodes.count();
  if (count > 0) return false;

  try {
    const res = await fetch("/seed/library.json");
    if (!res.ok) return false;

    const data = await res.json();
    const raw: Record<string, unknown>[] = Array.isArray(data) ? data : data.episodes;
    if (!Array.isArray(raw) || raw.length === 0) return false;

    // Track favorites from seed for restoration
    const seedFavorites = new Set<string>();
    for (const ep of raw) {
      if (ep.favoritedAt) {
        seedFavorites.add((ep.fileHash as string) ?? (ep.archiveIdentifier as string) ?? "");
      }
    }

    const now = Date.now();
    const episodes: Omit<Episode, "id">[] = raw.map((ep) => ({
      fileHash: (ep.fileHash as string) ?? `archive:${ep.archiveIdentifier ?? ep.fileName}`,
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
    }));

    await db.episodes.bulkAdd(episodes as Episode[]);

    // Restore playlists from seed if present
    if (data.playlists && Array.isArray(data.playlists)) {
      try {
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
      } catch {
        // Playlist restoration is best-effort
      }
    }

    toast.success(`Loaded ${episodes.length.toLocaleString()} episodes from catalog`);
    return true;
  } catch (err) {
    console.warn("[seed] Failed to load seed catalog:", err);
    return false;
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
