/**
 * The admin's "Export Library Seed..." tool: writes a `public/seed/library.json`
 * from the admin's own library (HD-025).
 *
 * Two things were wrong with the version that lived in `seed.ts`:
 *
 * 1. **Its output broke the server.** It wrote a `{version: 2, episodes,
 *    playlists}` envelope, and `src/services/stats/catalog.ts` reads the seed
 *    as a bare array — iterating the envelope object throws, the catalog load
 *    fails, and `/api/stats/export` and `/api/stats/failures` degrade to bare
 *    ids with no titles. The shipped file has always been a bare array, which
 *    is what both readers (`catalog.ts` and `seedLibraryIfEmpty`) accept, so
 *    that is what this writes.
 * 2. **It shipped the admin's personal data to every visitor.** Favourites and
 *    ratings were copied in "v2", and `toEpisodeRow` restores them on seed — so
 *    every new visitor would have started with the admin's favourites. The
 *    playlists went the same way.
 *
 * So the row is built from an **allowlist** of catalog fields, not by copying
 * the row and deleting the personal ones: a field added to `Episode` later is
 * left out until someone decides it belongs in the catalog, rather than
 * leaking by default. Local files (`source: "local"`) are left out entirely:
 * their `filePath` is a path on the admin's disk, and nobody else can play them.
 */
import { db } from "./index";
import type { Episode } from "./schema";
import { toast } from "@/stores/toast-store";
import { downloadJson } from "@/lib/utils/download";

/** Every field a catalog row may carry. Nothing personal: no favourites, ratings, flags, positions, play counts or timestamps. */
export const CATALOG_FIELDS = [
  "fileHash",
  "fileName",
  "filePath",
  "fileSize",
  "title",
  "artist",
  "airDate",
  "guestName",
  "showType",
  "topic",
  "description",
  "duration",
  "format",
  "source",
  "sourceUrl",
  "archiveIdentifier",
  "aiSummary",
  "aiTags",
  "aiCategory",
  "aiSeries",
  "aiSeriesPart",
  "aiNotable",
  "aiStatus",
] as const satisfies readonly (keyof Episode)[];

export type CatalogRow = Partial<Pick<Episode, (typeof CATALOG_FIELDS)[number]>>;

/**
 * The catalog as `public/seed/library.json` holds it: a bare array of rows.
 * Pure, so the test can hand its output straight to the real parser.
 */
export function buildCatalogExport(episodes: readonly Episode[]): CatalogRow[] {
  return episodes
    .filter((ep) => ep.source !== "local")
    .map((ep) => {
      const row: Record<string, unknown> = {};
      for (const field of CATALOG_FIELDS) {
        const value = ep[field];
        if (value === undefined || value === null || value === "") continue;
        if (Array.isArray(value) && value.length === 0) continue;
        row[field] = value;
      }
      return row as CatalogRow;
    });
}

/** Build the catalog from this browser's library and download it as `library.json`. */
export async function exportLibrarySeed(): Promise<void> {
  const rows = buildCatalogExport(await db.episodes.toArray());
  if (rows.length === 0) {
    toast.error("Library is empty — nothing to export");
    return;
  }
  // Compact JSON (no pretty print) — gzips well.
  const size = downloadJson("library.json", rows, { compact: true });
  const sizeMB = (size / 1024 / 1024).toFixed(1);
  toast.success(`Exported ${rows.length.toLocaleString()} episodes (${sizeMB} MB) — place in public/seed/`);
}
