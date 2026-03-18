/**
 * Derives a unique, deterministic, URL-safe community key per episode.
 *
 * archiveIdentifier is the archive.org *collection* ID — the same for every episode.
 * fileName is unique per episode, so the composite key is unique.
 *
 * Format: `{archiveIdentifier}--{sanitized_fileName}`
 * Returns null for episodes without an archiveIdentifier (local-only files).
 */
export function communityKey(
  episode: { archiveIdentifier?: string | null; fileName: string },
): string | null {
  if (!episode.archiveIdentifier) return null;

  // Strip file extension, replace non-URL-safe chars with underscores, cap length
  const sanitized = episode.fileName
    .replace(/\.[^.]+$/, "") // strip extension
    .replace(/[^a-zA-Z0-9_-]/g, "_") // URL-safe
    .slice(0, 120);

  return `${episode.archiveIdentifier}--${sanitized}`;
}
