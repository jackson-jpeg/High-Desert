import { db } from "./index";
import type { Episode } from "./schema";

/**
 * Normalize a title for comparison: lowercase, strip punctuation, collapse whitespace.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a dedup key for an episode.
 * Priority: archiveIdentifier > (normalized title + airDate) > fileHash
 */
function dedupKey(ep: Episode): string {
  if (ep.archiveIdentifier) {
    // Strip the file part if it's "identifier/file.mp3" format
    const base = ep.archiveIdentifier.split("/")[0];
    return `archive:${base}`;
  }
  const title = normalizeTitle(ep.title || ep.fileName);
  const date = ep.airDate || "unknown";
  return `title:${title}|${date}`;
}

/**
 * Score an episode by metadata richness. Higher = more complete.
 */
function metadataScore(ep: Episode): number {
  let score = 0;
  if (ep.title) score += 1;
  if (ep.airDate) score += 2;
  if (ep.guestName) score += 1;
  if (ep.aiSummary) score += 3;
  if (ep.aiCategory) score += 2;
  if (ep.aiTags?.length) score += 1;
  if (ep.aiStatus === "completed") score += 3;
  if (ep.playCount && ep.playCount > 0) score += 5;
  if (ep.playbackPosition && ep.playbackPosition > 0) score += 2;
  if (ep.favoritedAt) score += 3;
  if (ep.rating) score += 2;
  if (ep.duration) score += 1;
  return score;
}

export interface DeduplicateResult {
  totalBefore: number;
  duplicatesRemoved: number;
  groupsMerged: number;
}

/**
 * Find and remove duplicate episodes, keeping the most metadata-rich version.
 * Merges playback data (play count, position, favorites) from duplicates into the keeper.
 */
export async function deduplicateEpisodes(): Promise<DeduplicateResult> {
  const allEpisodes = (await db.episodes.toArray()) ?? [];
  const groups = new Map<string, Episode[]>();

  // Group by dedup key
  for (const ep of allEpisodes) {
    const key = dedupKey(ep);
    const group = groups.get(key) || [];
    group.push(ep);
    groups.set(key, group);
  }

  let duplicatesRemoved = 0;
  let groupsMerged = 0;

  for (const [, group] of groups) {
    if (group.length <= 1) continue;

    groupsMerged++;

    // Sort by metadata score descending — keep the best one
    group.sort((a, b) => metadataScore(b) - metadataScore(a));
    const keeper = group[0];
    const dupes = group.slice(1);

    // Merge playback data from duplicates
    let totalPlayCount = keeper.playCount ?? 0;
    let latestPlayed = keeper.lastPlayedAt ?? 0;
    let bestPosition = keeper.playbackPosition ?? 0;
    let bestDuration = keeper.duration ?? 0;

    for (const dupe of dupes) {
      totalPlayCount += dupe.playCount ?? 0;
      if ((dupe.lastPlayedAt ?? 0) > latestPlayed) {
        latestPlayed = dupe.lastPlayedAt!;
        // Use the position from the most recently played version
        bestPosition = dupe.playbackPosition ?? bestPosition;
      }
      if ((dupe.duration ?? 0) > bestDuration) {
        bestDuration = dupe.duration!;
      }
      // Keep favorite if any dupe was favorited
      if (dupe.favoritedAt && !keeper.favoritedAt) {
        keeper.favoritedAt = dupe.favoritedAt;
      }
      // Keep best rating
      if (dupe.rating && (!keeper.rating || dupe.rating > keeper.rating)) {
        keeper.rating = dupe.rating;
      }
    }

    // Merge AI fields and metadata gaps from duplicates into keeper
    for (const dupe of dupes) {
      if (!keeper.aiSummary && dupe.aiSummary) keeper.aiSummary = dupe.aiSummary;
      if (!keeper.aiCategory && dupe.aiCategory) keeper.aiCategory = dupe.aiCategory;
      if (!keeper.aiTags?.length && dupe.aiTags?.length) keeper.aiTags = dupe.aiTags;
      if (!keeper.aiSeries && dupe.aiSeries) keeper.aiSeries = dupe.aiSeries;
      if (!keeper.aiSeriesPart && dupe.aiSeriesPart) keeper.aiSeriesPart = dupe.aiSeriesPart;
      if (!keeper.aiNotable && dupe.aiNotable) keeper.aiNotable = dupe.aiNotable;
      if (keeper.aiStatus !== "completed" && dupe.aiStatus === "completed") keeper.aiStatus = dupe.aiStatus;
      if (!keeper.title && dupe.title) keeper.title = dupe.title;
      if (!keeper.guestName && dupe.guestName) keeper.guestName = dupe.guestName;
      if (!keeper.topic && dupe.topic) keeper.topic = dupe.topic;
      if (!keeper.description && dupe.description) keeper.description = dupe.description;
      if (!keeper.sourceUrl && dupe.sourceUrl) keeper.sourceUrl = dupe.sourceUrl;
    }

    // Update keeper with merged data
    await db.episodes.update(keeper.id!, {
      playCount: totalPlayCount,
      lastPlayedAt: latestPlayed || undefined,
      playbackPosition: bestPosition,
      duration: bestDuration || keeper.duration,
      favoritedAt: keeper.favoritedAt,
      rating: keeper.rating,
      aiSummary: keeper.aiSummary,
      aiCategory: keeper.aiCategory,
      aiTags: keeper.aiTags,
      aiSeries: keeper.aiSeries,
      aiSeriesPart: keeper.aiSeriesPart,
      aiNotable: keeper.aiNotable,
      aiStatus: keeper.aiStatus,
      title: keeper.title,
      guestName: keeper.guestName,
      topic: keeper.topic,
      description: keeper.description,
      sourceUrl: keeper.sourceUrl,
      updatedAt: Date.now(),
    });

    // Delete duplicates
    const dupeIds = dupes.map((d) => d?.id).filter((id): id is string => id != null);
    await db.episodes.bulkDelete(dupeIds);

    // Also update any history/bookmark/playlist references
    for (const dupeId of dupeIds) {
      await db.history.where("episodeId").equals(dupeId).modify({ episodeId: keeper.id! });
      await db.bookmarks.where("episodeId").equals(dupeId).modify({ episodeId: keeper.id! });
    }

    // Update playlists that reference deleted episodes
    const playlists = (await db.playlists.toArray()) ?? [];
    for (const playlist of playlists) {
      if (dupeIds.some((id) => playlist.episodeIds.includes(id))) {
        const newIds = playlist.episodeIds
          .map((id) => (dupeIds.includes(id) ? keeper.id! : id))
          .filter((id, i, arr) => arr.indexOf(id) === i); // remove duplicates
        await db.playlists.update(playlist.id!, { episodeIds: newIds });
      }
    }

    duplicatesRemoved += dupes.length;
  }

  return {
    totalBefore: allEpisodes.length,
    duplicatesRemoved,
    groupsMerged,
  };
}

/**
 * Check if an episode already exists (for import-time dedup).
 * Returns the existing episode if found, null otherwise.
 */
export async function findDuplicateEpisode(
  ep: Partial<Episode>,
): Promise<Episode | null> {
  // Check by archiveIdentifier first (strongest signal)
  if (ep.archiveIdentifier) {
    const base = ep.archiveIdentifier.split("/")[0];
    const existing = await db.episodes
      .where("archiveIdentifier")
      .startsWith(base)
      .first();
    if (existing) return existing;
  }

  // Check by fileHash
  if (ep.fileHash) {
    const existing = await db.episodes
      .where("fileHash")
      .equals(ep.fileHash)
      .first();
    if (existing) return existing;
  }

  return null;
}
