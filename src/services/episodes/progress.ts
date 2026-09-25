import { liveQuery } from "dexie";
import { db } from "@/db";
import type { Episode, Progress } from "@/db/schema";
import { useProgressStore } from "@/stores/progress-store";

/**
 * Reading and writing the `progress` table (HD-016) — where the listener is in
 * each episode, and when they last played it. Every write goes through
 * `writeProgress`; nothing writes `playbackPosition` or `lastPlayedAt` to
 * `db.episodes` any more, which is the whole point: a position save no longer
 * wakes the library.
 */

type ProgressFields = Partial<Omit<Progress, "fileHash">>;

/**
 * Merge `fields` into one episode's progress: in memory at once (the player
 * reads positions synchronously), then in IndexedDB. Rejects if the database
 * write fails — callers on the play path catch it.
 */
export async function writeProgress(fileHash: string, fields: ProgressFields): Promise<void> {
  if (!fileHash) return;
  useProgressStore.getState().patch(fileHash, fields);
  await db.progress.upsert(fileHash, fields);
}

let syncRefs = 0;
let stopSync: (() => void) | null = null;
let ready: Promise<void> | null = null;
let markReady: (() => void) | null = null;

function readyPromise(): Promise<void> {
  if (!ready) ready = new Promise<void>((resolve) => { markReady = resolve; });
  return ready;
}

/**
 * Keep the progress store equal to the table, across tabs (Dexie's live query
 * sees other tabs' writes). Ref-counted: the layout starts it once per page.
 * Returns the release.
 */
export function startProgressSync(): () => void {
  syncRefs++;
  if (syncRefs === 1) {
    void readyPromise();
    const sub = liveQuery(() => db.progress.toArray()).subscribe({
      next: (rows) => {
        useProgressStore.getState().replaceAll(rows);
        markReady?.();
      },
      error: (err) => {
        console.warn("[progress] live query failed:", err);
        // Nothing to wait for: readers fall back to "no saved position".
        markReady?.();
      },
    });
    stopSync = () => sub.unsubscribe();
  }
  return () => {
    syncRefs--;
    if (syncRefs === 0) {
      stopSync?.();
      stopSync = null;
    }
  };
}

/** Resolves once the store has the table's contents (or the read has failed). */
export function progressReady(): Promise<void> {
  if (useProgressStore.getState().loaded) return Promise.resolve();
  return readyPromise();
}

/** An episode together with its progress entry. */
export interface PlayedEpisode {
  episode: Episode;
  progress: Progress;
}

/**
 * Episodes by most recent play, newest first — "Recently played" and
 * "Continue listening". Reads `progress` by its `lastPlayedAt` index, then the
 * matching episode rows by `fileHash`; an entry whose episode is gone is
 * skipped. For a live query: it wakes on progress writes (which is what these
 * lists show) and on writes to the few episode rows it returned.
 */
export async function recentlyPlayedEpisodes(limit = Infinity): Promise<PlayedEpisode[]> {
  const entries = await db.progress.where("lastPlayedAt").above(0).reverse().sortBy("lastPlayedAt");
  if (entries.length === 0) return [];
  const rows = await db.episodes.where("fileHash").anyOf(entries.map((p) => p.fileHash)).toArray();
  const byHash = new Map<string, Episode>();
  for (const ep of rows.sort((a, b) => a.id! - b.id!)) if (!byHash.has(ep.fileHash)) byHash.set(ep.fileHash, ep);
  const out: PlayedEpisode[] = [];
  for (const progress of entries) {
    const episode = byHash.get(progress.fileHash);
    if (episode) out.push({ episode, progress });
    if (out.length >= limit) break;
  }
  return out;
}

export function resetProgressSyncForTests(): void {
  stopSync?.();
  stopSync = null;
  syncRefs = 0;
  ready = null;
  markReady = null;
}
