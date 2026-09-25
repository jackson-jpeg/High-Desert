import type { Episode } from "@/db/schema";

/**
 * Episodes pulled from the catalog, which returning visitors still have.
 *
 * `reconcileLibrary()` is bulkAdd-only and never deletes (CLAUDE.md, "Data
 * safety"), so a row removed from `public/seed/library.json` stops reaching
 * *new* visitors and stays in everyone else's IndexedDB. That is deliberate,
 * and it stays that way: nothing here deletes anything. It marks the row so
 * the listener is told the truth — the list and detail say **Unavailable**, a
 * play explains instead of asking archive.org for a file with no audio in it,
 * and the detail panel offers "Remove from my library", which goes through the
 * library's confirmation and `deleteEpisode()` (one transaction, tombstoned).
 *
 * An explicit list, not "absent from the current catalog": a local file or an
 * archive.org import the visitor added themselves is also absent from the
 * catalog, and must never be marked. Keyed by the exact `fileHash`
 * (`archiveFileHash()`), so only the pulled row itself matches.
 *
 * Every entry mirrors a section of `docs/broken-episodes.md`, where the full
 * original record lives; `removed-episodes.test.ts` holds the two to the same
 * set and checks none of them is back in the catalog.
 */

export interface RemovedEpisode {
  /** When it left the catalog (docs/broken-episodes.md). */
  pulled: string;
  /** One sentence for the listener: what is wrong with it. */
  reason: string;
}

export const REMOVED_FROM_CATALOG: ReadonlyMap<string, RemovedEpisode> = new Map([
  [
    "archive:ultimate-ultimate-art-bell-collection:2002-03-19 - Coast to Coast AM with Art Bell - Climate Change - Prof. Christina Hulbe.mp3",
    {
      pulled: "2026-07-29",
      reason: "The archive's copy of this broadcast contains no audio — only its cover art.",
    },
  ],
]);

/** The removal record for this row, if it is one of the pulled episodes. */
export function removedFromCatalog(
  episode: Pick<Episode, "fileHash"> | null | undefined,
): RemovedEpisode | undefined {
  const hash = episode?.fileHash;
  return hash ? REMOVED_FROM_CATALOG.get(hash) : undefined;
}

export function isRemovedFromCatalog(episode: Pick<Episode, "fileHash"> | null | undefined): boolean {
  return removedFromCatalog(episode) !== undefined;
}

/** What a play of a pulled episode says instead of trying to load it. */
export const UNAVAILABLE_TITLE = "No Longer in the Archive";
export const UNAVAILABLE_BODY =
  "This show was taken out of the catalog because the archive's copy has nothing to play. " +
  "It is still in your library because nothing is ever removed from it without asking you — " +
  "open it in the library to remove it.";
