import { db } from "./index";
import type { Episode } from "./schema";

/**
 * SAFETY RAILS — read before changing anything in this file.
 *
 * This module is the only code that bulk-deletes episodes. User data (favorites,
 * ratings, playback positions, history) exists ONLY in the browser's IndexedDB;
 * there is no server backup, so a bad delete here is unrecoverable.
 *
 * A previous version keyed episodes on `archiveIdentifier` alone. Every episode in
 * the seed catalog shares the identifier "ultimate-ultimate-art-bell-collection",
 * so all 1,313 collapsed into a single group and 1,312 were deleted. The rails
 * below (MAX_GROUP_SIZE / MAX_DELETE_RATIO) would have caught that regardless of
 * the key bug — keep them, and never run this unattended.
 */
const MAX_GROUP_SIZE = 20;
const MAX_DELETE_RATIO = 0.25;

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
 *
 * An episode's identity is the archive *collection* id PLUS the file within it —
 * `archiveIdentifier` alone is the collection and is shared by every episode
 * (see `src/lib/utils/community-key.ts`). Handles both storage shapes: the current
 * one (bare identifier + separate `fileName`) and the legacy "identifier/file.mp3".
 *
 * Priority: archive composite > fileHash > normalized title + air date.
 */
export function dedupKey(ep: Episode): string {
  if (ep.archiveIdentifier) {
    const parts = ep.archiveIdentifier.split("/");
    const base = parts[0];
    const file = ep.fileName || parts.slice(1).join("/");
    return `archive:${base}|${file}`;
  }
  if (ep.fileHash) {
    return `hash:${ep.fileHash}`;
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

export interface DedupGroup {
  keeper: Episode;
  dupes: Episode[];
  update: Partial<Episode>;
}

export interface DedupPlan {
  totalBefore: number;
  groups: DedupGroup[];
  duplicatesToRemove: number;
  largestGroup: number;
}

export interface DeduplicateResult {
  totalBefore: number;
  duplicatesRemoved: number;
  groupsMerged: number;
  aborted?: boolean;
  reason?: string;
}

/**
 * Compute what deduplication *would* do, without touching the database.
 * Pure — safe to unit test against the real seed catalog.
 */
export function planDeduplication(allEpisodes: Episode[]): DedupPlan {
  const groups = new Map<string, Episode[]>();

  for (const ep of allEpisodes) {
    const key = dedupKey(ep);
    const group = groups.get(key) || [];
    group.push(ep);
    groups.set(key, group);
  }

  const plan: DedupGroup[] = [];
  let duplicatesToRemove = 0;
  let largestGroup = 0;

  for (const [, group] of groups) {
    largestGroup = Math.max(largestGroup, group.length);
    if (group.length <= 1) continue;

    // Sort by metadata score descending — keep the best one
    const sorted = [...group].sort((a, b) => metadataScore(b) - metadataScore(a));
    const keeper = { ...sorted[0] };
    const dupes = sorted.slice(1);

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

    plan.push({
      keeper,
      dupes,
      update: {
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
      },
    });
    duplicatesToRemove += dupes.length;
  }

  return {
    totalBefore: allEpisodes.length,
    groups: plan,
    duplicatesToRemove,
    largestGroup,
  };
}

/**
 * Refuse plans that look like a bug rather than a genuine duplicate set.
 */
export function validatePlan(plan: DedupPlan): { ok: true } | { ok: false; reason: string } {
  const oversized = plan.groups.find((g) => g.dupes.length + 1 > MAX_GROUP_SIZE);
  if (oversized) {
    return {
      ok: false,
      reason:
        `Refusing to deduplicate: found a group of ${oversized.dupes.length + 1} supposedly ` +
        `identical episodes (limit ${MAX_GROUP_SIZE}). This indicates a bad dedup key, not duplicates.`,
    };
  }

  if (plan.totalBefore > 0 && plan.duplicatesToRemove / plan.totalBefore > MAX_DELETE_RATIO) {
    const pct = Math.round((plan.duplicatesToRemove / plan.totalBefore) * 100);
    return {
      ok: false,
      reason:
        `Refusing to deduplicate: this would delete ${plan.duplicatesToRemove} of ` +
        `${plan.totalBefore} episodes (${pct}%, limit ${Math.round(MAX_DELETE_RATIO * 100)}%).`,
    };
  }

  return { ok: true };
}

/**
 * Preview deduplication without modifying anything. Use this to show the user
 * what would happen before asking them to confirm.
 */
export async function previewDeduplication(): Promise<DedupPlan> {
  return planDeduplication(await db.episodes.toArray());
}

/**
 * Find and remove duplicate episodes, keeping the most metadata-rich version.
 * Merges playback data (play count, position, favorites) from duplicates into the keeper.
 *
 * NEVER call this unattended — it must be user-initiated and confirmed.
 * Aborts (without deleting anything) if the plan trips a safety rail.
 */
export async function deduplicateEpisodes(): Promise<DeduplicateResult> {
  const plan = planDeduplication(await db.episodes.toArray());

  const check = validatePlan(plan);
  if (!check.ok) {
    console.warn("[deduplicate] aborted:", check.reason);
    return {
      totalBefore: plan.totalBefore,
      duplicatesRemoved: 0,
      groupsMerged: 0,
      aborted: true,
      reason: check.reason,
    };
  }

  if (plan.groups.length === 0) {
    return { totalBefore: plan.totalBefore, duplicatesRemoved: 0, groupsMerged: 0 };
  }

  // All-or-nothing: a mid-run failure must not leave episodes deleted but unmerged.
  await db.transaction("rw", db.episodes, db.history, db.bookmarks, db.playlists, async () => {
    for (const { keeper, dupes, update } of plan.groups) {
      await db.episodes.update(keeper.id!, { ...update, updatedAt: Date.now() });

      const dupeIds = dupes.map((d) => d.id!).filter(Boolean);
      await db.episodes.bulkDelete(dupeIds);

      // Repoint history/bookmark references at the keeper
      for (const dupeId of dupeIds) {
        await db.history.where("episodeId").equals(dupeId).modify({ episodeId: keeper.id! });
        await db.bookmarks.where("episodeId").equals(dupeId).modify({ episodeId: keeper.id! });
      }

      // Update playlists that reference deleted episodes
      const playlists = await db.playlists.toArray();
      for (const playlist of playlists) {
        if (dupeIds.some((id) => playlist.episodeIds.includes(id))) {
          const newIds = playlist.episodeIds
            .map((id) => (dupeIds.includes(id) ? keeper.id! : id))
            .filter((id, i, arr) => arr.indexOf(id) === i); // remove duplicates
          await db.playlists.update(playlist.id!, { episodeIds: newIds });
        }
      }
    }
  });

  return {
    totalBefore: plan.totalBefore,
    duplicatesRemoved: plan.duplicatesToRemove,
    groupsMerged: plan.groups.length,
  };
}

/**
 * Check if an episode already exists (for import-time dedup).
 * Returns the existing episode if found, null otherwise.
 *
 * Matches on exact identity only. A prefix match on `archiveIdentifier` would match
 * every other file in the same collection — that bug made collection import stop
 * after its first file.
 */
export async function findDuplicateEpisode(
  ep: Partial<Episode>,
): Promise<Episode | null> {
  // fileHash is the strongest signal — the seeder and both import paths build it
  // identically as `archive:{identifier}:{fileName}`.
  if (ep.fileHash) {
    const existing = await db.episodes.where("fileHash").equals(ep.fileHash).first();
    if (existing) return existing;
  }

  // Fall back to the archive composite, tolerating both storage shapes.
  if (ep.archiveIdentifier) {
    const parts = ep.archiveIdentifier.split("/");
    const base = parts[0];
    const file = ep.fileName || parts.slice(1).join("/");
    if (file) {
      const matches = await db.episodes.where("fileName").equals(file).toArray();
      const existing = matches.find(
        (m) => (m.archiveIdentifier ?? "").split("/")[0] === base,
      );
      if (existing) return existing;
    }
  }

  return null;
}
