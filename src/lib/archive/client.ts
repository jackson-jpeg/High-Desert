import type { ArchiveSearchResult, ArchiveItem, ArchiveFile } from "./types";

interface SearchResponse {
  numFound: number;
  docs: ArchiveSearchResult[];
}

export async function searchArchive(
  query: string,
  page = 1,
  rows = 30,
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    rows: String(rows),
  });
  const res = await fetch(`/api/archive/search?${params.toString()}`);
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}

export async function getArchiveItem(identifier: string): Promise<ArchiveItem> {
  const res = await fetch(`/api/archive/metadata?id=${encodeURIComponent(identifier)}`);
  if (!res.ok) throw new Error("Metadata fetch failed");
  return res.json();
}

export function getStreamUrl(identifier: string, filename: string): string {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(filename)}`;
}

export function pickBestAudioFile(files: ArchiveFile[]): ArchiveFile | null {
  // Prefer original source MP3s, then any MP3, sorted by size descending
  const originals = files.filter((f) => f.source === "original" && f.name.endsWith(".mp3"));
  if (originals.length > 0) {
    return originals.sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
  }

  const mp3s = files.filter((f) => f.format.includes("MP3"));
  if (mp3s.length > 0) {
    return mp3s.sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
  }

  return files[0] ?? null;
}
