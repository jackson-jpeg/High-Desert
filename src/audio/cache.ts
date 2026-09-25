/**
 * OPFS Audio Cache
 *
 * Caches audio blobs in the Origin Private File System for offline playback.
 *
 * **The cache shares a quota with the listener's library** (HD-010). OPFS and
 * IndexedDB draw on one per-origin budget, and when an origin runs out the
 * browser does not evict the audio first — Chrome evicts the *whole origin*,
 * favourites and history included. The scanner used to fire-and-forget a copy
 * of every scanned file in parallel with no size check, so one large folder
 * could push the origin over. So writes here are:
 *
 * - **Checked** against `navigator.storage.estimate()` first, and refused if
 *   they would take usage past `CACHE_QUOTA_FRACTION` of the quota. The
 *   remainder is headroom for the data that cannot be refetched.
 * - **Serialized**: one at a time. Each check reads usage *after* the previous
 *   write landed; checked in parallel, twenty writes would all see the same
 *   free space and all pass.
 * - **Never partial**: a write that fails midway aborts and removes its entry,
 *   so a truncated file cannot be served later as a "valid" cache hit.
 * - **Never thrown**: `cacheAudioBlob` resolves with an outcome. It runs beside
 *   playback, and a caching failure must never become a playback failure.
 *
 * Where `estimate()` is unavailable (Safari before 17 has OPFS but not
 * `estimate()`) the write is **refused**. The cache is an optional speed-up;
 * writing blind into a quota we cannot see is exactly the risk above, and the
 * cost of refusing is only that a local file is not kept for offline play.
 */
import { toast } from "@/stores/toast-store";

const CACHE_DIR = "audio-cache";

/**
 * The share of the origin's quota the audio cache may fill up to. Usage
 * counts everything the origin stores, so the remaining 20% is kept for
 * IndexedDB — the listener's library, which has no other copy.
 */
export const CACHE_QUOTA_FRACTION = 0.8;

export type CacheWriteResult =
  | "written"
  | "unsupported"      // no OPFS
  | "no-estimate"      // OPFS but no storage.estimate(): refused, see above
  | "over-quota"       // would cross CACHE_QUOTA_FRACTION: refused
  | "failed";          // the write itself threw; nothing left behind

function sanitizeKey(fileHash: string): string {
  return fileHash.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function isOPFSSupported(): boolean {
  return typeof navigator !== "undefined" && "storage" in navigator && "getDirectory" in navigator.storage;
}

async function getCacheDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(CACHE_DIR, { create: true });
}

/** Tail of the write queue. Every write waits for the one before it. */
let writeQueue: Promise<unknown> = Promise.resolve();
let warnedFull = false;

async function hasRoomFor(bytes: number): Promise<"ok" | "no-estimate" | "over-quota"> {
  if (typeof navigator.storage.estimate !== "function") return "no-estimate";
  let usage: number | undefined;
  let quota: number | undefined;
  try {
    ({ usage, quota } = await navigator.storage.estimate());
  } catch {
    return "no-estimate";
  }
  if (typeof usage !== "number" || typeof quota !== "number" || !(quota > 0)) return "no-estimate";
  return usage + bytes > quota * CACHE_QUOTA_FRACTION ? "over-quota" : "ok";
}

async function writeOne(fileHash: string, blob: Blob): Promise<CacheWriteResult> {
  if (!isOPFSSupported()) return "unsupported";

  const room = await hasRoomFor(blob.size);
  if (room !== "ok") {
    if (room === "over-quota" && !warnedFull) {
      // Once per page load: the scanner calls this per file, and forty
      // identical toasts would bury the scan's own progress.
      warnedFull = true;
      toast.info("Storage is nearly full — new audio isn't being saved for offline play");
    }
    return room;
  }

  const key = sanitizeKey(fileHash);
  let dir: FileSystemDirectoryHandle | null = null;
  let writable: FileSystemWritableFileStream | null = null;
  try {
    dir = await getCacheDir();
    const fileHandle = await dir.getFileHandle(key, { create: true });
    writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "written";
  } catch (err) {
    console.warn("[cache] OPFS write failed:", err);
    // Leave nothing behind: a half-written entry would later read back as a
    // non-empty, "valid" cache hit and be played instead of the network copy.
    try { await writable?.abort(); } catch { /* already closed or errored */ }
    try { await dir?.removeEntry(key); } catch { /* never created */ }
    return "failed";
  }
}

/**
 * Cache a blob for offline playback, if there is room. Queued behind any
 * write already in progress. Resolves with what happened; never rejects.
 */
export function cacheAudioBlob(fileHash: string, blob: Blob): Promise<CacheWriteResult> {
  const run = writeQueue.then(() => writeOne(fileHash, blob)).catch((err): CacheWriteResult => {
    console.warn("[cache] OPFS write failed:", err);
    return "failed";
  });
  writeQueue = run;
  return run;
}

export async function getCachedAudio(fileHash: string): Promise<Blob | null> {
  if (!isOPFSSupported()) return null;
  try {
    const dir = await getCacheDir();
    const key = sanitizeKey(fileHash);
    const fileHandle = await dir.getFileHandle(key);
    const file = await fileHandle.getFile();
    // Validate the cached file isn't empty/corrupt
    if (file.size === 0) return null;
    return file;
  } catch {
    return null;
  }
}

/**
 * Pattern for handling stale OPFS blob URLs:
 *
 * When using getCachedAudio() to create a blob URL for an <audio> element,
 * the blob URL can become stale if the OPFS entry is removed or corrupted.
 * Always attach an error handler that falls back to the network URL:
 *
 *   const cached = await getCachedAudio(episode.fileHash);
 *   if (cached) {
 *     const blobUrl = URL.createObjectURL(cached);
 *     audio.src = blobUrl;
 *     audio.onerror = () => {
 *       URL.revokeObjectURL(blobUrl);
 *       audio.src = episode.sourceUrl; // fallback to network
 *     };
 *   }
 */

export async function hasCachedAudio(fileHash: string): Promise<boolean> {
  if (!isOPFSSupported()) return false;
  try {
    const dir = await getCacheDir();
    const key = sanitizeKey(fileHash);
    await dir.getFileHandle(key);
    return true;
  } catch {
    return false;
  }
}

export async function removeCachedAudio(fileHash: string): Promise<void> {
  if (!isOPFSSupported()) return;
  try {
    const dir = await getCacheDir();
    const key = sanitizeKey(fileHash);
    await dir.removeEntry(key);
  } catch {
    // File may not exist
  }
}

export async function clearAudioCache(): Promise<void> {
  if (!isOPFSSupported()) return;
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(CACHE_DIR, { recursive: true });
  } catch {
    // Directory may not exist
  }
}

export async function getCacheSize(): Promise<number> {
  if (!isOPFSSupported()) return 0;
  let total = 0;
  try {
    const dir = await getCacheDir();
    for await (const [, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile();
        total += file.size;
      }
    }
  } catch {
    // Ignore errors
  }
  return total;
}
