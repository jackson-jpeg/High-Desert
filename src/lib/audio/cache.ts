/**
 * OPFS Audio Cache
 *
 * Caches audio blobs in the Origin Private File System for offline playback.
 */

const CACHE_DIR = "audio-cache";

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

export async function cacheAudioBlob(fileHash: string, blob: Blob): Promise<void> {
  if (!isOPFSSupported()) return;
  const dir = await getCacheDir();
  const key = sanitizeKey(fileHash);
  const fileHandle = await dir.getFileHandle(key, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function getCachedAudio(fileHash: string): Promise<Blob | null> {
  if (!isOPFSSupported()) return null;
  try {
    const dir = await getCacheDir();
    const key = sanitizeKey(fileHash);
    const fileHandle = await dir.getFileHandle(key);
    const file = await fileHandle.getFile();
    return file;
  } catch {
    return null;
  }
}

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
