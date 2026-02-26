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
  
  // Check storage quota and cleanup if needed
  await cleanupIfNeeded(blob.size);
  
  const fileHandle = await dir.getFileHandle(key, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  
  // Update last access time
  await updateLastAccessTime(key);
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
    
    // Update last access time on successful read
    await updateLastAccessTime(key);
    return file;
  } catch {
    return null;
  }
}

/**
 * Check if a cached audio entry exists and has non-zero size.
 * Use this for quick validation without reading the full blob.
 */
export async function isCacheValid(fileHash: string): Promise<boolean> {
  if (!isOPFSSupported()) return false;
  try {
    const dir = await getCacheDir();
    const key = sanitizeKey(fileHash);
    const fileHandle = await dir.getFileHandle(key);
    const file = await fileHandle.getFile();
    return file.size > 0;
  } catch {
    return false;
  }
}

export async function extractAudioMetadata(blob: Blob): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  error?: string;
}> {
  try {
    const metadata = await parseBlob(blob, {
      duration: true,
      skipCovers: true,
      skipPostHeaders: true
    });
    
    return {
      title: metadata.common.title,
      artist: metadata.common.artist,
      album: metadata.common.album,
      duration: metadata.format.duration
    };
  } catch (error) {
    console.warn('[audio] Failed to extract metadata:', error instanceof Error ? error.message : 'Unknown error');
    
    // Return partial metadata or error indication
    return {
      error: error instanceof Error ? error.message : 'Metadata extraction failed',
      title: undefined,
      artist: undefined,
      album: undefined,
      duration: undefined
    };
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

async function getCacheEntries(): Promise<Array<{key: string, size: number, lastAccess: number}>> {
  if (!isOPFSSupported()) return [];
  const entries: Array<{key: string, size: number, lastAccess: number}> = [];
  try {
    const dir = await getCacheDir();
    const metadataDir = await getMetadataDir();
    
    for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile();
        const lastAccess = await getLastAccessTime(name, metadataDir);
        entries.push({
          key: name,
          size: file.size,
          lastAccess
        });
      }
    }
  } catch {
    // Ignore errors
  }
  return entries;
}

async function getMetadataDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(`${CACHE_DIR}-metadata`, { create: true });
}

async function getLastAccessTime(key: string, metadataDir?: FileSystemDirectoryHandle): Promise<number> {
  if (!isOPFSSupported()) return Date.now();
  try {
    const dir = metadataDir || await getMetadataDir();
    const fileHandle = await dir.getFileHandle(`${key}.access`, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return parseInt(text, 10) || Date.now();
  } catch {
    return Date.now();
  }
}

async function updateLastAccessTime(key: string): Promise<void> {
  if (!isOPFSSupported()) return;
  try {
    const dir = await getMetadataDir();
    const fileHandle = await dir.getFileHandle(`${key}.access`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(String(Date.now()));
    await writable.close();
  } catch {
    // Ignore errors
  }
}

async function cleanupIfNeeded(newSize: number): Promise<void> {
  if (!isOPFSSupported()) return;
  
  const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500 MB
  
  try {
    const currentSize = await getCacheSize();
    if (currentSize + newSize > MAX_CACHE_SIZE) {
      const entries = await getCacheEntries();
      // Sort by last access time (oldest first)
      entries.sort((a, b) => a.lastAccess - b.lastAccess);
      
      let freed = 0;
      const dir = await getCacheDir();
      const metadataDir = await getMetadataDir();
      
      for (const entry of entries) {
        if (freed >= newSize) break;
        
        try {
          await dir.removeEntry(entry.key);
          await metadataDir.removeEntry(`${entry.key}.access`).catch(() => {});
          freed += entry.size;
        } catch {
          // Ignore removal errors
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Extract audio metadata using music-metadata-browser with error handling
 */
export async function extractAudioMetadata(blob: Blob): Promise<{
  duration?: number;
  title?: string;
  artist?: string;
  album?: string;
  picture?: ArrayBuffer;
} | null> {
  try {
    // Dynamically import music-metadata-browser to avoid bundling issues
    const { parseBlob } = await import('music-metadata-browser');
    const metadata = await parseBlob(blob, { 
      duration: true,
      skipCovers: false 
    });
    
    return {
      duration: metadata.format.duration,
      title: metadata.common.title,
      artist: metadata.common.artist,
      album: metadata.common.album,
      picture: metadata.common.picture?.[0]?.data
    };
  } catch (error) {
    console.warn('Failed to extract audio metadata:', error);
    return null;
  }
}24; // 500MB
  const currentSize = await getCacheSize();
  
  if (currentSize + newSize > MAX_CACHE_SIZE) {
    const entries = await getCacheEntries();
    // Sort by last access time (oldest first)
    entries.sort((a, b) => a.lastAccess - b.lastAccess);
    
    let sizeToFree = (currentSize + newSize) - MAX_CACHE_SIZE;
    
    for (const entry of entries) {
      if (sizeToFree <= 0) break;
      
      try {
        const dir = await getCacheDir();
        await dir.removeEntry(entry.key);
        
        // Also remove metadata
        const metadataDir = await getMetadataDir();
        await metadataDir.removeEntry(`${entry.key}.access`).catch(() => {});
        
        sizeToFree -= entry.size;
      } catch {
        // Ignore errors during cleanup
      }
    }
  }
}
