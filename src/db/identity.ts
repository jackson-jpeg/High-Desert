/**
 * The one definition of an archive episode's identity key.
 *
 * `archive:{identifier}:{fileName}` — the item (or collection) id PLUS the file
 * inside it. The seeder, collection import and the catalog scraper must all build
 * it through this function: `findDuplicateEpisode()`, `reconcileLibrary()`, the
 * doubled-library heal and tombstones all match on the exact string, so two
 * spellings of one episode are two episodes as far as every one of them is
 * concerned.
 *
 * The catalog scraper once wrote `archive:{identifier}` with no file name. The
 * v8 upgrade in `./index.ts` (see `./legacy-keys.ts`) rewrites the rows it left.
 *
 * Deliberately free of any Dexie import so both the schema module and pure
 * tests can use it.
 */
export function archiveFileHash(identifier: string, fileName: string): string {
  return `archive:${identifier}:${fileName}`;
}
