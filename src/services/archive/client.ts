import type { ArchiveSearchResult, ArchiveItem, ArchiveFile } from "./types";
import { fetchWithRetry } from "@/lib/utils/retry";

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  const res = await fetchWithRetry(`/api/archive/search?${params.toString()}`, { signal: controller.signal });
  clearTimeout(timeoutId);
  if (!res.ok) throw new Error("Search failed");
  const data = await res.json();
  
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid search response structure');
  }
  
  if (!Array.isArray(data.docs) || typeof data.numFound !== 'number') {
    throw new Error('Missing or invalid search response data');
  }
  
  return data as SearchResponse;
}

function isValidArchiveIdentifier(identifier: string): boolean {
  // Archive.org identifiers: alphanumeric, dash, underscore, dot
  // Must start with alphanumeric, max 100 chars
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(identifier);
}

export async function getArchiveItem(identifier: string): Promise<ArchiveItem> {
  if (!isValidArchiveIdentifier(identifier)) {
    throw new Error(`Invalid archive identifier: ${identifier}`);
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  const res = await fetchWithRetry(`/api/archive/metadata?id=${encodeURIComponent(identifier)}`, { signal: controller.signal });
  clearTimeout(timeoutId);
  if (!res.ok) throw new Error("Metadata fetch failed");
  const data = await res.json();
  
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid metadata response structure');
  }
  
  if (!data.identifier || !data.metadata || !Array.isArray(data.files)) {
    throw new Error('Missing required metadata fields');
  }
  
  return data as ArchiveItem;
}

export function getStreamUrl(identifier: string, filename: string): string {
  if (!isValidArchiveIdentifier(identifier)) {
    throw new Error(`Invalid archive identifier: ${identifier}`);
  }
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(filename)}`;
}

export function pickBestAudioFile(files: ArchiveFile[]): ArchiveFile | null {
  // Prefer original source MP3s, then any MP3, then OGG/VBR, then any audio format
  const originals = files.filter((f) => f.source === "original" && f.name.endsWith(".mp3"));
  if (originals.length > 0) {
    return originals.sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
  }

  const mp3s = files.filter((f) => f.format.includes("MP3") || f.name.endsWith(".mp3"));
  if (mp3s.length > 0) {
    return mp3s.sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
  }

  // Fallback to OGG Vorbis (browser-playable)
  const oggs = files.filter((f) => f.format.includes("Ogg") || f.name.endsWith(".ogg"));
  if (oggs.length > 0) {
    return oggs.sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
  }

  // Any audio file (FLAC, WAV, etc.)
  const audioFormats = ["FLAC", "WAV", "AIFF", "VBR MP3"];
  const audio = files.filter((f) => audioFormats.some((fmt) => f.format.includes(fmt)));
  if (audio.length > 0) {
    return audio.sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
  }

  return null;
}
