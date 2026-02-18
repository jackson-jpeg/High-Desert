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

  // Playback
  lastPlayedAt?: number;  // Unix timestamp
  playbackPosition?: number; // Seconds
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
