import type { Episode, Progress } from "@/db/schema";
import { communityKey } from "@/lib/utils/community-key";

/**
 * Pure helpers behind the library's episode detail panel (HD-018): the edit
 * draft, the play-stats line, playback progress, series ordering and the
 * share link. No React, no Dexie, no DOM.
 */

export const SHOW_TYPE_OPTIONS: { value: Episode["showType"]; label: string }[] = [
  { value: "coast", label: "Coast to Coast" },
  { value: "dreamland", label: "Dreamland" },
  { value: "special", label: "Special" },
  { value: "unknown", label: "Unknown" },
];

// ---------------------------------------------------------------------------
// Edit draft
// ---------------------------------------------------------------------------

/** The editable fields, as the form holds them: plain strings, "" for absent. */
export interface EpisodeEditDraft {
  title: string;
  guestName: string;
  airDate: string;
  topic: string;
  showType: Episode["showType"];
  aiSummary: string;
  aiCategory: string;
  aiSeries: string;
}

export function draftFromEpisode(episode: Episode): EpisodeEditDraft {
  return {
    title: episode.title ?? "",
    guestName: episode.guestName ?? "",
    airDate: episode.airDate ?? "",
    topic: episode.topic ?? "",
    showType: episode.showType ?? "unknown",
    aiSummary: episode.aiSummary ?? "",
    aiCategory: episode.aiCategory ?? "",
    aiSeries: episode.aiSeries ?? "",
  };
}

/**
 * The draft as fields for `onEdit`. An emptied text field becomes `undefined`
 * — i.e. *clear it* — rather than an empty string stored on the row. Show type
 * is a closed set and always has a value, so it passes through as-is.
 */
export function draftToFields(draft: EpisodeEditDraft): Partial<Episode> {
  return {
    title: draft.title || undefined,
    guestName: draft.guestName || undefined,
    airDate: draft.airDate || undefined,
    topic: draft.topic || undefined,
    showType: draft.showType,
    aiSummary: draft.aiSummary || undefined,
    aiCategory: draft.aiCategory || undefined,
    aiSeries: draft.aiSeries || undefined,
  };
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

/**
 * "Played 3x · yesterday · 42% heard" — empty when there is nothing to say.
 * `progress` is the episode's entry in the `progress` table (HD-016).
 */
export function formatPlayStats(
  episode: Episode,
  progress: Progress | undefined,
  now: number = Date.now(),
): string {
  const parts: string[] = [];
  if (episode.playCount != null && episode.playCount > 0) {
    parts.push(`Played ${episode.playCount}x`);
  }
  const lastPlayedAt = progress?.lastPlayedAt;
  if (lastPlayedAt != null && lastPlayedAt > 0) {
    const ago = now - lastPlayedAt;
    const days = Math.floor(ago / 86400000);
    const label = days === 0 ? "today" : days === 1 ? "yesterday" : days < 7 ? `${days}d ago` : new Date(lastPlayedAt).toLocaleDateString();
    parts.push(label);
  }
  const position = progress?.playbackPosition;
  if (episode.duration && position) {
    const pct = Math.round((position / episode.duration) * 100);
    if (pct > 0 && pct < 100) parts.push(`${pct}% heard`);
    else if (pct >= 100) parts.push("completed");
  }
  return parts.join(" · ");
}

/**
 * How far into the show the saved position is, as a width percentage capped
 * at 100, and whether that counts as nearly finished (past 90%, drawn green).
 * `null` when there is no position or no known duration to measure it against.
 */
export function playbackProgress(
  episode: Episode,
  progress: Progress | undefined,
): { percent: number; nearlyDone: boolean } | null {
  const pos = progress?.playbackPosition;
  const dur = episode.duration;
  if (pos == null || pos <= 0 || dur == null || dur <= 0) return null;
  return {
    percent: Math.min(100, (pos / dur) * 100),
    nearlyDone: pos / dur > 0.9,
  };
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

/**
 * A series in part order, which is not always air order. Parts without a
 * number go last; ties (or two unnumbered parts) fall back to air date.
 */
export function sortSeriesParts(parts: Episode[]): Episode[] {
  return [...parts].sort((a, b) => {
    const partA = a.aiSeriesPart ?? 999;
    const partB = b.aiSeriesPart ?? 999;
    return partA - partB || (a.airDate ?? "").localeCompare(b.airDate ?? "");
  });
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export function archiveDetailsUrl(episode: Episode): string | null {
  if (!episode.archiveIdentifier) return null;
  return `https://archive.org/details/${episode.archiveIdentifier}${episode.fileName ? `/${episode.fileName}` : ""}`;
}

/**
 * Share by community key, not episode.id. `id` is a per-browser IndexedDB
 * auto-increment, so a shared link opened by anyone else resolved to a
 * different episode, or to none at all. The community key is derived from the
 * archive identifier and file name, so it is the same everywhere.
 */
export function shareUrl(origin: string, episode: Episode): string {
  const shareKey = communityKey(episode);
  return shareKey
    ? `${origin}/library?ep=${encodeURIComponent(shareKey)}`
    : `${origin}/library`;
}

export function shareText(episode: Episode): string {
  return `🎙️ ${episode.title || episode.fileName}${episode.guestName ? `, Art Bell with ${episode.guestName}` : ""}${episode.airDate ? ` (${episode.airDate})` : ""}. Listen on High Desert`;
}
