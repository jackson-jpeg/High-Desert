import { db, getPreference, setPreference } from "./index";
import { withSeedLock } from "./seed-lock";
import notable from "../../data/notable.json";

/**
 * Bring existing visitors' catalog rows up to date with the curated notable
 * list (`data/notable.json`, cited in `data/notable.md`).
 *
 * The seed carries `aiNotable: true` on those rows, but the seed only reaches a
 * library once: `reconcileLibrary()` is bulkAdd-only and never touches an
 * existing row, which is exactly right for user data and exactly why a catalog
 * flag added later never arrives for anyone who already visited.
 *
 * **Deliberately the narrowest write that could do this** — a third exception
 * to "no unattended writes to db.episodes" alongside `healDoubledLibrary()` and
 * the v8 key upgrade (CLAUDE.md, "Data safety"):
 *
 *   - It only ever **sets** `aiNotable: true`, and only on rows whose `fileHash`
 *     is on the curated list. It never clears the flag (an admin may have set
 *     one by hand), never touches another field, never adds or deletes a row.
 *   - Runs once per `NOTABLE_VERSION` per library, gated before any read.
 *   - Holds the cross-tab `"hd-seed"` lock and does its read and writes inside
 *     one rw transaction, like the seed and reconcile.
 *
 * `src/db/__tests__/notable.test.ts` asserts on what survives: every other
 * field of every row, byte for byte.
 */

/** Bump when `data/notable.json` changes, so returning visitors re-run this once. */
export const NOTABLE_VERSION = "2026-09-24-a";

const NOTABLE_PREF = "catalog-notable";

export const NOTABLE_HASHES: readonly string[] = (notable as { fileHash: string }[]).map((e) => e.fileHash);

/** Returns how many rows gained the flag. */
export function refreshCatalogFlags(): Promise<number> {
  return withSeedLock(_refreshCatalogFlags);
}

async function _refreshCatalogFlags(): Promise<number> {
  try {
    if ((await getPreference(NOTABLE_PREF)) === NOTABLE_VERSION) return 0;
    let changed = 0;
    await db.transaction("rw", db.episodes, db.userPrefs, async () => {
      const rows = await db.episodes.where("fileHash").anyOf(NOTABLE_HASHES as string[]).toArray();
      for (const row of rows) {
        if (row.aiNotable === true) continue;
        await db.episodes.update(row.id!, { aiNotable: true });
        changed++;
      }
      await setPreference(NOTABLE_PREF, NOTABLE_VERSION);
    });
    return changed;
  } catch (err) {
    console.warn("[catalog-flags] notable refresh failed:", err);
    return 0;
  }
}
