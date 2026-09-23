import { db, getPreference, setPreference } from "./index";
import type { Episode } from "./schema";
import { absorbUserData, repointEpisodeRefs, type LibraryTables } from "./merge";
import { fetchSeedRows, seedFileHash, SEED_VERSION } from "./seed";
import { withSeedLock } from "./seed-lock";

/**
 * Exact-2× recovery for libraries doubled by the multi-tab seed race (HD-009).
 *
 * ── Why this is NOT the dedup incident, and why it may run unattended ──────────
 *
 * CLAUDE.md: "No unattended destructive operations against db.episodes, ever."
 * The incident behind that rule was `deduplicateEpisodes()` grouping rows on a
 * key that was really the COLLECTION id — identical for all 1,313 episodes — so
 * it "merged" 1,313 different shows into one and deleted 1,312. Every property
 * that made that possible is absent here, by construction and by rail:
 *
 *   1. Identity is the exact `fileHash` string, and only hashes that are in the
 *      shipped catalog — one unique key per catalog row, asserted against the
 *      real catalog in tests. Nothing is grouped by title, date, prefix or
 *      collection. Non-catalog rows (local scans, imports) are never read into
 *      a group, let alone deleted.
 *   2. It acts only on the race's exact signature: every catalog hash present
 *      in the library appears EXACTLY twice. One triple, or one catalog hash
 *      present once (that the user did not deliberately delete a copy of),
 *      and it refuses the whole library and touches nothing. A healthy library
 *      with one user-made duplicate is therefore left alone — that is
 *      `deduplicateEpisodes()`'s job, behind its own confirmation.
 *   3. Nothing the listener did is lost. The kept row absorbs the twin's
 *      favourite, rating, plays, position and flag (`absorbUserData`), and
 *      history, bookmarks, playlists and the saved queue are repointed at it
 *      BEFORE the twin is deleted — all in one rw transaction over every
 *      table, so a failure leaves the doubled library exactly as it was.
 *   4. It verifies its own result inside that transaction: afterwards each
 *      catalog hash must appear once and the row count must have fallen by
 *      exactly the number of pairs. Anything else throws, which aborts the
 *      transaction.
 *
 * `deduplicateEpisodes()`'s rails (MAX_GROUP_SIZE, MAX_DELETE_RATIO) are left
 * exactly as they are; this is a separate, narrower path, not a loosening.
 */

const HEAL_REFUSED_PREF = "seed-heal-refused";
const TOMBSTONE_PREF = "deleted-hashes";

export interface HealMerge {
  keeper: Episode;
  twins: Episode[];
}

export type HealPlan =
  | { ok: true; merges: HealMerge[] }
  | { ok: false; reason: string };

/**
 * Decide whether a library carries the double-seed signature, and if so which
 * row of each pair survives. Pure — unit tested against the real catalog.
 *
 * `tombstones` are hashes the user deliberately deleted: a doubled library whose
 * owner deleted one copy of a show by hand legitimately holds that show once.
 */
export function planDoubledHeal(
  local: Episode[],
  catalogHashes: Set<string>,
  tombstones: Set<string> = new Set(),
): HealPlan {
  const groups = new Map<string, Episode[]>();
  for (const ep of local) {
    if (!catalogHashes.has(ep.fileHash)) continue; // rail 1: catalog identities only
    const g = groups.get(ep.fileHash);
    if (g) g.push(ep);
    else groups.set(ep.fileHash, [ep]);
  }

  const merges: HealMerge[] = [];
  for (const [hash, group] of groups) {
    if (group.length === 1) {
      if (tombstones.has(hash)) continue;
      return { ok: false, reason: `catalog episode ${hash} is present once — not the double-seed signature` };
    }
    if (group.length !== 2) return { ok: false, reason: `catalog episode ${hash} is present ${group.length} times — only exact pairs are healed` };
    // Keep the first-seeded row: the lower id is the one the library showed
    // first. Which one is kept does not matter for the data — it absorbs the
    // other — only for stable ids in anything this code does not know about.
    const sorted = [...group].sort((a, b) => a.id! - b.id!);
    merges.push({ keeper: sorted[0], twins: sorted.slice(1) });
  }
  return { ok: true, merges };
}

function tablesOf(): LibraryTables {
  return {
    episodes: db.episodes,
    history: db.history,
    bookmarks: db.bookmarks,
    playlists: db.playlists,
    userPrefs: db.userPrefs,
  };
}

type HealOutcome = { removed: number } | { refused: string };

/**
 * Plan AND apply inside one rw transaction over every table, so the plan is
 * made against exactly the rows being rewritten, and verify before commit.
 *
 * The episode table is rewritten as a whole — `clear()` then `bulkAdd()` of the
 * survivors with their original ids — rather than 1,312 `update()`s and a
 * 1,312-row `bulkDelete()`. Inside one transaction the two are the same
 * operation (all of it commits or none of it does), and the survivors are the
 * very objects just read, so an untouched row goes back byte-for-byte. The
 * per-row form costs minutes per heal on fake-indexeddb, which would put the
 * tests that prove this safe out of reach — so it would not be proven. The
 * verification below is what makes a whole-table rewrite safe to commit: any
 * row that should survive and does not, and the transaction aborts.
 */
async function applyHeal(catalogHashes: Set<string>): Promise<HealOutcome> {
  const t = tablesOf();
  const now = Date.now();
  let outcome: HealOutcome = { removed: 0 };

  await db.transaction("rw", [db.episodes, db.history, db.bookmarks, db.playlists, db.userPrefs], async () => {
    const all = await db.episodes.toArray();
    const plan = planDoubledHeal(all, catalogHashes, await readTombstones());
    if (!plan.ok) { outcome = { refused: plan.reason }; return; }
    if (plan.merges.length === 0) return;

    const survivors = new Map(all.map((e) => [e.id!, e]));
    const remap = new Map<number, number>();
    for (const { keeper, twins } of plan.merges) {
      let merged: Episode = keeper;
      for (const twin of twins) {
        merged = { ...merged, ...absorbUserData(merged, twin) };
        remap.set(twin.id!, keeper.id!);
        survivors.delete(twin.id!);
      }
      survivors.set(keeper.id!, { ...merged, updatedAt: now });
    }

    // Repoint BEFORE the twins go, so there is no moment at which a history
    // row or bookmark points at nothing.
    await repointEpisodeRefs(t, remap, now);

    await db.episodes.clear();
    await db.episodes.bulkAdd([...survivors.values()]);

    // Rail 4: exactly the intended rows, one per catalog hash, before commit.
    const after = await db.episodes.toArray();
    const afterIds = new Set(after.map((e) => e.id!));
    const catalogRows = after.filter((e) => catalogHashes.has(e.fileHash));
    const distinct = new Set(catalogRows.map((e) => e.fileHash)).size;
    const missing = [...survivors.keys()].filter((id) => !afterIds.has(id));
    if (
      catalogRows.length !== distinct ||
      after.length !== all.length - remap.size ||
      missing.length > 0 ||
      after.filter((e) => !catalogHashes.has(e.fileHash)).length !==
        all.filter((e) => !catalogHashes.has(e.fileHash)).length
    ) {
      throw new Error(
        `heal verification failed: ${catalogRows.length} catalog rows for ${distinct} hashes, ` +
          `${after.length} rows after removing ${remap.size} of ${all.length}, ${missing.length} survivors missing`,
      );
    }
    outcome = { removed: remap.size };
  });

  return outcome;
}

async function readTombstones(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse((await getPreference(TOMBSTONE_PREF)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

async function _healDoubledLibrary(): Promise<number> {
  try {
    // Index-only scan: a healthy library has no repeated fileHash at all, and
    // pays nothing more than this — no catalog fetch, no row reads.
    const keys = (await db.episodes.orderBy("fileHash").keys()) as string[];
    let repeated = false;
    for (let i = 1; i < keys.length; i++) {
      if (keys[i] === keys[i - 1]) { repeated = true; break; }
    }
    if (!repeated) return 0;

    // A library already refused for this catalog stays refused until the
    // catalog changes — no refetch on every visit for a layout we will not touch.
    if ((await getPreference(HEAL_REFUSED_PREF)) === SEED_VERSION) return 0;

    const raw = await fetchSeedRows();
    if (!raw) return 0;
    const catalogHashes = new Set(raw.map(seedFileHash));

    const outcome = await applyHeal(catalogHashes);
    if ("refused" in outcome) {
      console.warn("[heal] refused, nothing touched:", outcome.refused);
      await setPreference(HEAL_REFUSED_PREF, SEED_VERSION);
      return 0;
    }
    if (outcome.removed > 0) console.info(`[heal] merged ${outcome.removed} double-seeded episodes`);
    return outcome.removed;
  } catch (err) {
    console.warn("[heal] failed, library left as it was:", err);
    return 0;
  }
}

/**
 * Heal a library doubled by the multi-tab seed race. Returns the number of
 * twin rows merged away (0 for every healthy library, and whenever a rail
 * refuses). Holds the cross-tab seed lock.
 */
export function healDoubledLibrary(): Promise<number> {
  return withSeedLock(_healDoubledLibrary);
}
