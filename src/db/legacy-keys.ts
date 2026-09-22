import type { Episode } from "./schema";
import { archiveFileHash } from "./identity";
import { absorbUserData, repointEpisodeRefs, type LibraryTables } from "./merge";

/**
 * One-time rewrite of the identity keys the old catalog scraper wrote (HD-025).
 *
 * `useCatalogScraper` built `fileHash` as `archive:{identifier}` — no file name —
 * while the seeder and collection import build `archive:{identifier}:{fileName}`
 * (`./identity.ts`). Every exact-identity check in the app (import dedup,
 * reconcile, tombstones, the doubled-library heal) therefore treated a scraped
 * episode and the same file arriving any other way as two different episodes.
 *
 * Runs as the Dexie v8 upgrade (`./index.ts`), i.e. exactly once per browser, in
 * the versionchange transaction, which spans every table: a failure leaves the
 * database at v7 with nothing changed.
 *
 * What it touches, and nothing else:
 *
 *   - A row is legacy only if `fileHash === "archive:" + archiveIdentifier`
 *     exactly, the identifier is a bare item id (no "/"), and it has a
 *     `fileName` to build the canonical key from. Anything else is left alone.
 *   - A legacy row whose canonical key is free is renamed in place — same id,
 *     so history, bookmarks, playlists and the queue keep pointing at it.
 *   - A legacy row whose canonical key already exists is the SAME episode
 *     present twice. The existing canonical row absorbs its user data by the
 *     same rule as the heal (`absorbUserData`), every reference is repointed,
 *     and only then is the legacy row removed. User data is never dropped.
 *
 * It must never throw out of the upgrade: an upgrade that throws leaves the
 * database unopenable, which is worse than leaving a legacy key in place. So it
 * plans purely first, refuses (logs, writes nothing) on anything it does not
 * expect, and only then writes.
 */

/** A collision group bigger than this is not "the same file imported twice". */
const MAX_COLLISION_GROUP = 3;

export function isLegacyScraperRow(ep: Episode): boolean {
  const id = ep.archiveIdentifier;
  return (
    !!id &&
    !id.includes("/") &&
    !!ep.fileName &&
    ep.fileHash === `archive:${id}`
  );
}

export interface LegacyKeyPlan {
  /** Legacy rows renamed in place: id → canonical fileHash. */
  renames: Map<number, string>;
  /** Legacy rows folded into an existing row: legacy id → keeper id. */
  merges: Map<number, number>;
  /** Groups left untouched because they tripped a rail. */
  skipped: string[];
}

/** Pure — what the upgrade will do to these rows. */
export function planLegacyKeyMigration(rows: Episode[]): LegacyKeyPlan {
  const plan: LegacyKeyPlan = { renames: new Map(), merges: new Map(), skipped: [] };

  const byHash = new Map<string, Episode[]>();
  for (const ep of rows) {
    if (isLegacyScraperRow(ep)) continue;
    const g = byHash.get(ep.fileHash);
    if (g) g.push(ep);
    else byHash.set(ep.fileHash, [ep]);
  }

  const legacyByTarget = new Map<string, Episode[]>();
  for (const ep of rows) {
    if (!isLegacyScraperRow(ep)) continue;
    const target = archiveFileHash(ep.archiveIdentifier!, ep.fileName);
    const g = legacyByTarget.get(target);
    if (g) g.push(ep);
    else legacyByTarget.set(target, [ep]);
  }

  for (const [target, legacy] of legacyByTarget) {
    const existing = [...(byHash.get(target) ?? [])].sort((a, b) => a.id! - b.id!);
    if (existing.length + legacy.length > MAX_COLLISION_GROUP) {
      plan.skipped.push(target);
      continue;
    }
    const sortedLegacy = [...legacy].sort((a, b) => a.id! - b.id!);
    // The canonical row wins if there is one — its key is already the one every
    // other path looks up. Otherwise the first legacy row becomes canonical.
    const keeper = existing[0] ?? sortedLegacy[0];
    if (!existing[0]) plan.renames.set(keeper.id!, target);
    for (const ep of sortedLegacy) {
      if (ep.id === keeper.id) continue;
      plan.merges.set(ep.id!, keeper.id!);
    }
  }

  return plan;
}

export async function migrateLegacyScraperKeys(t: LibraryTables): Promise<void> {
  try {
    const rows = await t.episodes.toArray();
    const plan = planLegacyKeyMigration(rows);
    if (plan.skipped.length > 0) {
      console.warn(`[db v8] left ${plan.skipped.length} legacy key group(s) untouched:`, plan.skipped);
    }
    if (plan.renames.size === 0 && plan.merges.size === 0) return;

    const byId = new Map(rows.map((r) => [r.id!, r]));
    const now = Date.now();

    for (const [id, fileHash] of plan.renames) {
      await t.episodes.update(id, { fileHash });
    }

    // Fold each merged row's user data into its keeper, accumulating when
    // several fold into one.
    const acc = new Map<number, { row: Episode; changes: Partial<Episode> }>();
    for (const [legacyId, keeperId] of plan.merges) {
      const cur = acc.get(keeperId) ?? { row: byId.get(keeperId)!, changes: {} };
      const absorbed = absorbUserData(cur.row, byId.get(legacyId)!);
      acc.set(keeperId, { row: { ...cur.row, ...absorbed }, changes: { ...cur.changes, ...absorbed } });
    }
    for (const [keeperId, { changes }] of acc) {
      await t.episodes.update(keeperId, { ...changes, updatedAt: now });
    }

    // Repoint BEFORE deleting, so nothing is ever left pointing at a missing row.
    await repointEpisodeRefs(t, plan.merges, now);
    await t.episodes.bulkDelete([...plan.merges.keys()]);

    console.info(`[db v8] canonicalised ${plan.renames.size} legacy key(s), merged ${plan.merges.size}`);
  } catch (err) {
    // Only an IndexedDB request failure can reach here. Rethrowing would make
    // Dexie raise UpgradeError on this and every future open — the library
    // would not load at all. Swallowing it is safe because of the write order
    // above: renames go to keys nothing holds, keepers only GAIN fields,
    // references move to rows that exist, and the one destructive write (the
    // bulkDelete) is last. Stopping anywhere before it leaves at worst a
    // legacy row still present beside its keeper — nothing orphaned or lost.
    console.warn("[db v8] legacy key migration failed:", err);
  }
}
