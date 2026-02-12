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

  // Audio info
  duration?: number;     // Seconds
  bitrate?: number;      // kbps
  sampleRate?: number;
  format?: string;       // "mp3", "wma", "wav", etc.

  // Playback
  lastPlayedAt?: number;  // Unix timestamp
  playbackPosition?: number; // Seconds
  playCount?: number;

  // AI enrichment
  aiSummary?: string;
  aiTags?: string[];

  // Housekeeping
  scanSessionId?: number;
  createdAt: number;     // Unix timestamp
  updatedAt: number;     // Unix timestamp
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
