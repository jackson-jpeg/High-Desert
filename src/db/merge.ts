import type { EntityTable } from "dexie";
import type { Episode, HistoryEntry, Bookmark, Playlist, UserPrefs, StoredEpisode } from "./schema";

/**
 * Folding one episode row into another that has the SAME identity, without
 * losing anything the listener did to either.
 *
 * Shared by the three places that retire a row in favour of a twin:
 *
 *   - `deduplicateEpisodes()` — user-initiated, behind its own rails;
 *   - `healDoubledLibrary()` (`./heal.ts`) — the exact-pair recovery for the
 *     multi-tab double seed;
 *   - the v8 legacy-key upgrade (`./legacy-keys.ts`).
 *
 * Nothing here decides WHETHER two rows are the same episode. That is the
 * caller's job, and it is the part that went wrong in the dedup incident (a key
 * that was the collection id, shared by all 1,313 rows). These functions only
 * make sure that once a caller has proven two rows are one episode, the merge
 * keeps every favourite, rating, play, flag, history row, bookmark, playlist
 * slot and queue entry.
 *
 * Every function takes table handles rather than importing `db`, so the schema
 * module's upgrade transaction (which must use `tx.table(...)`) can call them.
 * Callers are responsible for running them inside ONE rw transaction that spans
 * all five tables — a merge that repoints history but not bookmarks is exactly
 * the half-done state this exists to prevent.
 */
export interface LibraryTables {
  episodes: EntityTable<Episode, "id">;
  history: EntityTable<HistoryEntry, "id">;
  bookmarks: EntityTable<Bookmark, "id">;
  playlists: EntityTable<Playlist, "id">;
  userPrefs: EntityTable<UserPrefs, "id">;
}

/** Preference keys whose values are episode ids. Keep in sync with (desktop)/layout.tsx. */
export const QUEUE_IDS_PREF = "queue-ids";
export const LAST_EPISODE_PREF = "last-episode-id";

function earliest(a?: number, b?: number): number | undefined {
  if (a === undefined || a === null) return b ?? undefined;
  if (b === undefined || b === null) return a;
  return Math.min(a, b);
}

/**
 * The fields `keeper` must take on so that it carries everything `twin` had.
 * Pure. Only returns keys with a value — it never clears anything on the keeper.
 *
 *   - favourite / flag: kept if EITHER row had it, at the earlier timestamp
 *     (when the listener first did it).
 *   - rating: the most recently updated row's rating wins — it is the
 *     listener's latest opinion — falling back to whichever row has one.
 *   - playCount: summed. Each copy's plays were real plays; the twin being
 *     picked by the library list on some visits and the keeper on others is
 *     exactly how a doubled library splits them.
 *   - lastPlayedAt: the later. playbackPosition: from the row played last, so
 *     "resume" resumes where they actually stopped. These two are the pre-v9
 *     fields (`StoredEpisode`): since v9 progress lives in the `progress`
 *     table, keyed by fileHash, which twins of the same hash already share.
 *     They are still merged here because the v8 legacy-key upgrade runs this
 *     *before* the v9 upgrade copies them (./progress-migration.ts) — drop
 *     them here and a database jumping from v7 would lose the twin's position.
 *   - catalog metadata: gaps on the keeper are filled from the twin, never
 *     overwritten.
 */
export function absorbUserData(keeper: StoredEpisode, twin: StoredEpisode): Partial<StoredEpisode> {
  const out: Partial<StoredEpisode> = {};

  const fav = earliest(keeper.favoritedAt, twin.favoritedAt);
  if (fav !== undefined) out.favoritedAt = fav;

  const flag = earliest(keeper.flaggedAt, twin.flaggedAt);
  if (flag !== undefined) out.flaggedAt = flag;

  const twinNewer = (twin.updatedAt ?? 0) > (keeper.updatedAt ?? 0);
  const rating = twinNewer ? (twin.rating ?? keeper.rating) : (keeper.rating ?? twin.rating);
  if (rating !== undefined) out.rating = rating;

  if (keeper.playCount !== undefined || twin.playCount !== undefined) {
    out.playCount = (keeper.playCount ?? 0) + (twin.playCount ?? 0);
  }

  const kPlayed = keeper.lastPlayedAt ?? 0;
  const tPlayed = twin.lastPlayedAt ?? 0;
  if (kPlayed || tPlayed) out.lastPlayedAt = Math.max(kPlayed, tPlayed);
  // Seeded rows carry lastPlayedAt: 0 from the v3 upgrade; keep that shape
  // rather than dropping the key when neither was ever played.
  else if (keeper.lastPlayedAt !== undefined || twin.lastPlayedAt !== undefined) out.lastPlayedAt = 0;

  const position = tPlayed > kPlayed
    ? (twin.playbackPosition ?? keeper.playbackPosition)
    : (keeper.playbackPosition ?? twin.playbackPosition);
  if (position !== undefined) out.playbackPosition = position;

  const gapFields = [
    "title", "artist", "airDate", "guestName", "showType", "topic", "description",
    "duration", "sourceUrl", "aiSummary", "aiTags", "aiCategory", "aiSeries",
    "aiSeriesPart", "aiNotable",
  ] as const;
  for (const f of gapFields) {
    const k = keeper[f];
    const t = twin[f];
    const empty = k === undefined || k === null || (Array.isArray(k) && k.length === 0);
    if (empty && t !== undefined && t !== null) (out as Record<string, unknown>)[f] = t;
  }
  if (keeper.aiStatus !== "completed" && twin.aiStatus === "completed") out.aiStatus = "completed";

  return out;
}

/**
 * Point every reference to a retired id at its keeper: history, bookmarks,
 * playlist membership and the persisted queue / last-played preference.
 *
 * `remap` is retired id → keeper id. Playlists that end up holding the keeper
 * twice keep it once, at its first position; a playlist that referenced none of
 * the retired ids is not written at all (its `updatedAt` is the listener's
 * "last modified" and must not be bumped by housekeeping).
 */
export async function repointEpisodeRefs(
  t: LibraryTables,
  remap: Map<number, number>,
  now: number,
): Promise<void> {
  if (remap.size === 0) return;
  const retired = [...remap.keys()];

  await t.history.where("episodeId").anyOf(retired).modify((h) => { h.episodeId = remap.get(h.episodeId)!; });
  await t.bookmarks.where("episodeId").anyOf(retired).modify((b) => { b.episodeId = remap.get(b.episodeId)!; });

  const playlists = await t.playlists.toArray();
  for (const pl of playlists) {
    if (!pl.episodeIds.some((id) => remap.has(id))) continue;
    const seen = new Set<number>();
    const episodeIds: number[] = [];
    for (const id of pl.episodeIds) {
      const to = remap.get(id) ?? id;
      if (seen.has(to)) continue;
      seen.add(to);
      episodeIds.push(to);
    }
    await t.playlists.update(pl.id!, { episodeIds, updatedAt: now });
  }

  const queuePref = await t.userPrefs.where("key").equals(QUEUE_IDS_PREF).first();
  if (queuePref) {
    try {
      const ids = JSON.parse(queuePref.value) as unknown;
      if (Array.isArray(ids) && ids.some((id) => remap.has(id as number))) {
        const next = ids.map((id) => remap.get(id as number) ?? id);
        await t.userPrefs.update(queuePref.id!, { value: JSON.stringify(next) });
      }
    } catch {
      // Corrupt queue data is ignored by the restore path too; leave it.
    }
  }

  const lastPref = await t.userPrefs.where("key").equals(LAST_EPISODE_PREF).first();
  if (lastPref) {
    const to = remap.get(parseInt(lastPref.value, 10));
    if (to !== undefined) await t.userPrefs.update(lastPref.id!, { value: String(to) });
  }
}
