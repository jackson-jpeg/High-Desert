export interface Episode {
  id?: number;           // Auto-increment
  fileHash: string;      // MD5 of first 10MB
  filePath: string;      // Full path or filename
  fileName: string;      // Just the filename
  fileSize: number;      // Bytes

  // Metadata
  title?: string;
  artist?: string;       // Usually "Art Bell"
  album?: string;
  year?: number;

  // Parsed info
  airDate?: string;      // ISO date string YYYY-MM-DD
  guestName?: string;
  showType?: "coast" | "dreamland" | "special" | "unknown";
  topic?: string;
  description?: string;  // Archive.org description or user-provided

  // Audio info
  duration?: number;     // Seconds
  bitrate?: number;      // kbps
  sampleRate?: number;
  format?: string;       // "mp3", "wma", "wav", etc.

  // Playback. Where the listener is (`playbackPosition`) and when they last
  // played it (`lastPlayedAt`) are NOT here: they live in the `progress` table,
  // keyed by fileHash (HD-016) — see `Progress` below.
  playCount?: number;

  // Archive.org
  sourceUrl?: string;          // archive.org streaming URL
  source?: "local" | "archive"; // episode origin
  archiveIdentifier?: string;  // "coast-to-coast-am-2007-04-07/file.mp3"

  // AI enrichment
  aiSummary?: string;
  aiTags?: string[];
  aiCategory?: string;           // High-level subject: "UFOs & Aliens", "Paranormal", etc.
  aiSeries?: string;             // Series name for multi-part episodes (e.g. "Mel's Hole")
  aiSeriesPart?: number;         // Part number within a series
  aiNotable?: boolean;           // Flagged as particularly famous/iconic episode
  aiStatus?: "pending" | "completed" | "failed";

  // User actions
  favoritedAt?: number;   // Unix timestamp, undefined = not favorited
  rating?: number;        // 1-5 star rating, undefined = unrated
  flaggedAt?: number;     // Unix timestamp — user reported broken/dead link

  // Housekeeping
  scanSessionId?: number;
  createdAt: number;     // Unix timestamp
  updatedAt: number;     // Unix timestamp
}

export interface Playlist {
  id?: number;
  name: string;
  description?: string;
  episodeIds: number[];
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  id?: number;
  episodeId: number;
  timestamp: number;     // When playback started
  duration: number;      // Seconds listened in this session
  episodeTitle?: string; // Denormalized for display
  guestName?: string;    // Denormalized for display
}

export interface Bookmark {
  id?: number;
  episodeId: number;
  position: number;     // Seconds into the episode
  label: string;        // Short description of the moment
  createdAt: number;
}

export interface ScanSession {
  id?: number;
  startedAt: number;
  completedAt?: number;
  rootPath: string;
  totalFiles: number;
  processedFiles: number;
  newEpisodes: number;
  duplicates: number;
  errors: number;
  status: "scanning" | "completed" | "cancelled" | "error";
}

export interface UserPrefs {
  id?: number;
  key: string;
  value: string;
}

/**
 * Where the listener is in one episode — the `progress` table (Dexie v9, HD-016).
 *
 * These two fields used to live on the episode row, so the player's position
 * save (every 30 s while playing, and on every pause and page hide) woke every
 * live query over `db.episodes`: the library list, its facets, smart playlists,
 * the stats page. A table of their own means a save wakes only what reads
 * progress.
 *
 * Keyed by `fileHash`, the episode's identity (src/db/identity.ts): it is what
 * Export/Import already travel by, it is unchanged by the dedup / heal /
 * legacy-key merges that retire numeric ids, and two rows of a doubled library
 * (HD-009) share one position instead of splitting it.
 */
export interface Progress {
  fileHash: string;
  playbackPosition?: number; // Seconds
  lastPlayedAt?: number;     // Unix timestamp (ms)
}

/**
 * The pre-v9 fields as they still sit on episode rows written before the
 * `progress` table existed. The v9 upgrade copies them into `progress` and
 * leaves them in place (src/db/progress-migration.ts explains why); nothing
 * reads them after that except the v8 legacy-key merge, which runs *before*
 * the copy in the same upgrade chain and must carry them across.
 */
export interface LegacyPlaybackFields {
  playbackPosition?: number;
  lastPlayedAt?: number;
}

/** An episode row as it may exist on disk: the current shape plus the frozen pre-v9 fields. */
export type StoredEpisode = Episode & LegacyPlaybackFields;
