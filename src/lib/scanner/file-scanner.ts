/**
 * file-scanner.ts
 *
 * Discovers audio files from the user's filesystem using either
 * the modern File System Access API (showDirectoryPicker) or
 * the legacy <input webkitdirectory> fallback.
 */

// ── File System Access API type augmentation ───────────────────────────
// These APIs are not yet in the default TypeScript DOM lib types.

declare global {
  interface Window {
    showDirectoryPicker?: (
      options?: { mode?: "read" | "readwrite" }
    ) => Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }
}

// ── Audio file extensions ──────────────────────────────────────────────

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wma",
  ".wav",
  ".m4a",
  ".ogg",
  ".flac",
  ".aac",
]);

/**
 * Check whether a filename has a recognized audio extension.
 */
export function isAudioFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return AUDIO_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

// ── API availability ───────────────────────────────────────────────────

/**
 * Returns `true` if the browser supports `window.showDirectoryPicker()`
 * (File System Access API). As of 2025, supported in Chrome/Edge; not
 * yet in Firefox or Safari.
 */
export function supportsDirectoryPicker(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function"
  );
}

// ── Types ──────────────────────────────────────────────────────────────

export interface ScanResult {
  files: File[];
  rootName: string;
}

// ── File System Access API approach ────────────────────────────────────

/**
 * Recursively walk a FileSystemDirectoryHandle and yield audio Files.
 */
async function* walkDirectory(
  dirHandle: FileSystemDirectoryHandle
): AsyncGenerator<File> {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === "file") {
      if (isAudioFile(entry.name)) {
        try {
          const file = await entry.getFile();
          yield file;
        } catch (err) {
          // Permission denied or file inaccessible -- skip it
          console.warn(`[scanner] Could not read file "${entry.name}":`, err);
        }
      }
    } else if (entry.kind === "directory") {
      yield* walkDirectory(entry);
    }
  }
}

/**
 * Opens a native directory picker dialog and recursively collects
 * all audio files within the selected directory.
 *
 * Uses the File System Access API (`showDirectoryPicker`). Check
 * `supportsDirectoryPicker()` before calling.
 *
 * @returns An async generator that yields File objects, plus the
 *          root directory name is available after the picker resolves.
 * @throws If the user cancels the picker or the API is unavailable.
 *
 * @example
 * const { files, rootName } = await scanDirectory();
 */
export async function scanDirectory(): Promise<ScanResult> {
  if (!supportsDirectoryPicker()) {
    throw new Error(
      "File System Access API is not supported in this browser. " +
      "Use scanFallback() with <input webkitdirectory> instead."
    );
  }

  // Safe to assert: supportsDirectoryPicker() guard above ensures this exists.
  const dirHandle = await window.showDirectoryPicker!({ mode: "read" });
  const files: File[] = [];

  for await (const file of walkDirectory(dirHandle)) {
    files.push(file);
  }

  return {
    files,
    rootName: dirHandle.name,
  };
}

/**
 * Async generator variant of scanDirectory for streaming processing.
 * Opens the directory picker and yields files one at a time.
 *
 * @example
 * for await (const file of scanDirectoryStream()) {
 *   console.log(file.name);
 * }
 */
export async function* scanDirectoryStream(): AsyncGenerator<File> {
  if (!supportsDirectoryPicker()) {
    throw new Error(
      "File System Access API is not supported in this browser. " +
      "Use scanFallback() with <input webkitdirectory> instead."
    );
  }

  // Safe to assert: supportsDirectoryPicker() guard above ensures this exists.
  const dirHandle = await window.showDirectoryPicker!({ mode: "read" });
  yield* walkDirectory(dirHandle);
}

// ── Fallback: <input webkitdirectory> ──────────────────────────────────

/**
 * Filters a FileList (from `<input type="file" webkitdirectory>`)
 * to only include audio files.
 *
 * @param fileList - FileList from the input change event
 * @returns Array of audio File objects
 *
 * @example
 * <input type="file" webkitdirectory onChange={e => {
 *   const files = scanFallback(e.target.files!);
 * }} />
 */
export function scanFallback(fileList: FileList): File[] {
  const files: File[] = [];
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (isAudioFile(file.name)) {
      files.push(file);
    }
  }
  return files;
}

/**
 * Async generator variant of scanFallback for consistent API with
 * the directory picker approach.
 */
export async function* scanFallbackStream(
  fileList: FileList
): AsyncGenerator<File> {
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (isAudioFile(file.name)) {
      yield file;
    }
  }
}
