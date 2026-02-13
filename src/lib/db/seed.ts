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
      aiStatus: (ep.aiStatus as Episode["aiStatus"]) ?? "completed",
      createdAt: now,
      updatedAt: now,
    }));

    await db.episodes.bulkAdd(episodes as Episode[]);
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
    if (ep.aiStatus) obj.aiStatus = ep.aiStatus;
    return obj;
  });

  // Compact JSON (no pretty print) — gzips well on CDN
  const json = JSON.stringify(seed);
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
