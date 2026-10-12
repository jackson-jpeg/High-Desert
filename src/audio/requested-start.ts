/**
 * A start position someone asked for: "Open in High Desert" from a shared
 * moment (`/library?show=<key>&t=<seconds>`, docs/show-pages.md). One request
 * at a time, for one show, used by the next start of that show and then gone.
 *
 * `playEpisode()` reads it synchronously where the start position is decided
 * (after the live station, before the saved position), so nothing is awaited
 * before `play()`. No React, no store.
 */

let pending: { fileHash: string; at: number } | null = null;

/** The next start of `fileHash` begins at `seconds`. Replaces any earlier request. */
export function requestStartAt(fileHash: string, seconds: number): void {
  if (!fileHash || !Number.isFinite(seconds) || seconds < 0) return;
  pending = { fileHash, at: Math.floor(seconds) };
}

/**
 * The requested start for this episode, consumed: a later start of the same
 * show is an ordinary one. Null when there is none for it (a request for
 * another show stays pending). A request at or past the show's end is dropped.
 */
export function takeRequestedStart(episode: { fileHash?: string; duration?: number }): number | null {
  if (!pending || !episode.fileHash || pending.fileHash !== episode.fileHash) return null;
  const { at } = pending;
  pending = null;
  if (episode.duration && Number.isFinite(episode.duration) && at >= episode.duration) return null;
  return at;
}

/** The pending request, unconsumed: for the library to say "press play". */
export function peekRequestedStart(): { fileHash: string; at: number } | null {
  return pending;
}

export function resetRequestedStartForTests(): void {
  pending = null;
}
