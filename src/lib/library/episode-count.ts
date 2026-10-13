/**
 * The status bar's episode count (2026-10-13). A first visit read "0 episodes"
 * for several seconds, in both looks, while the library was being seeded: the
 * live count answers 0 before the seed's first write. An empty table is a
 * count only once the seed has settled (a library the visitor cleared).
 */
export function knownEpisodeCount(count: number | undefined, seedSettled: boolean): number | null {
  if (count === undefined) return null;
  if (count === 0 && !seedSettled) return null;
  return count;
}

/** "1,413 episodes", "1 episode", or "Loading library" while unknown. */
export function episodeCountLabel(count: number | null): string {
  if (count === null) return "Loading library";
  return `${count.toLocaleString()} episode${count !== 1 ? "s" : ""}`;
}
