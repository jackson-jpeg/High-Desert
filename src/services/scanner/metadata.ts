/**
 * metadata.ts
 *
 * Extracts audio metadata (ID3 tags, duration, bitrate, etc.)
 * from File objects using the music-metadata-browser library.
 */

// Dynamically imported to avoid loading ~25KB in the main bundle
// Only used when admin uses the scanner feature
type MM = typeof import("music-metadata-browser");

export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  duration?: number;   // seconds
  bitrate?: number;    // kbps
  sampleRate?: number; // Hz
  format?: string;     // "mp3", "flac", "ogg", etc.
}

/**
 * Map a MIME / codec container string to a friendly format name.
 */
function normalizeFormat(container?: string): string | undefined {
  if (!container) return undefined;

  const lower = container.toLowerCase();

  // Common mappings
  const map: Record<string, string> = {
    "mpeg":       "mp3",
    "mp3":        "mp3",
    "mp4":        "m4a",
    "m4a":        "m4a",
    "flac":       "flac",
    "ogg":        "ogg",
    "vorbis":     "ogg",
    "opus":       "ogg",
    "wav":        "wav",
    "wave":       "wav",
    "riff":       "wav",
    "asf":        "wma",
    "wma":        "wma",
    "aac":        "aac",
    "aiff":       "aiff",
  };

  for (const [key, value] of Object.entries(map)) {
    if (lower.includes(key)) return value;
  }

  return lower;
}

/**
 * Extract audio metadata from a File object.
 *
 * Handles errors gracefully: if parsing fails partially, returns
 * whatever fields could be extracted. If parsing fails entirely,
 * returns an empty object.
 *
 * @param file - A File object (from input, drag-drop, or File System Access API)
 * @returns An AudioMetadata object with available fields
 *
 * @example
 * const meta = await extractMetadata(audioFile);
 * // { title: "Open Lines", artist: "Art Bell", duration: 14400, bitrate: 64, ... }
 */
export async function extractMetadata(file: File): Promise<AudioMetadata> {
  const result: AudioMetadata = {};

  try {
    const mm: MM = await import("music-metadata-browser");
    const parsed = await mm.parseBlob(file, {
      duration: true,
      skipCovers: true,  // We don't need album art
    });

    // ID3 / Vorbis common tags
    const { common } = parsed;
    if (common.title) result.title = common.title;
    if (common.artist) result.artist = common.artist;
    if (common.album) result.album = common.album;
    if (common.year) result.year = common.year;

    // Audio format info
    const { format } = parsed;
    if (format.duration && format.duration > 0) {
      result.duration = Math.round(format.duration);
    }
    if (format.bitrate && format.bitrate > 0) {
      // music-metadata returns bitrate in bits/sec; convert to kbps
      result.bitrate = Math.round(format.bitrate / 1000);
    }
    if (format.sampleRate && format.sampleRate > 0) {
      result.sampleRate = format.sampleRate;
    }

    result.format = normalizeFormat(format.container);
  } catch (error) {
    // Log but don't throw -- return whatever partial data we have.
    // In practice the result object may be empty if parsing failed early.
    console.warn(
      `[metadata] Failed to parse metadata for "${file.name}":`,
      error instanceof Error ? error.message : error
    );
  }

  return result;
}
