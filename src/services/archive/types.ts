export interface ArchiveSearchResult {
  identifier: string;
  title?: string;
  date?: string;
  description?: string;
  creator?: string;
  downloads?: number;
}

export interface ArchiveFile {
  name: string;
  format: string;
  size?: string;
  length?: string;
  source?: string;
}

export interface ArchiveItem {
  identifier: string;
  metadata: {
    title?: string;
    date?: string;
    description?: string;
    creator?: string;
  };
  files: ArchiveFile[];
}
