import type { Table } from "dexie";
import type { Progress, StoredEpisode } from "./schema";

/**
 * The v9 upgrade (HD-016): copy every episode row's `playbackPosition` and
 * `lastPlayedAt` into the new `progress` table, keyed by `fileHash`.
 *
 * **Copy, never move.** The old fields are left on the episode rows. Stripping
 * them would be a second write to every row of `db.episodes` inside an upgrade
 * — the one place a bug cannot be undone, over the one table with no server
 * backup — and would buy nothing: after v9 no code reads them (the `Episode`
 * type no longer has them, and the `lastPlayedAt` index is dropped, so a stray
 * `where("lastPlayedAt")` throws instead of answering from frozen data). Left in
 * place they are a snapshot a later upgrade could re-derive from if this copy
 * were ever found wrong. The migration test asserts that every other field of
 * every row is untouched.
 *
 * Two rows can share a `fileHash` (a library doubled by two first-visit tabs,
 * HD-009, that has not been healed yet). They become one progress entry by
 * `mergeProgress` — the same rule the heal applies to episode rows.
 */
export async function copyLegacyProgress(
  episodes: Table<StoredEpisode>,
  progress: Table<Progress>,
): Promise<number> {
  const byHash = new Map<string, Progress>();
  let unkeyed = 0;
  await episodes.each((ep) => {
    const entry = legacyProgressOf(ep);
    if (!entry) return;
    if (!ep.fileHash) {
      unkeyed++;
      return;
    }
    byHash.set(ep.fileHash, mergeProgress(byHash.get(ep.fileHash), entry));
  });
  if (unkeyed > 0) {
    // fileHash is required and indexed; a row without one cannot be keyed. Its
    // position stays on the row, where it always was.
    console.warn(`[db] v9: ${unkeyed} played row(s) have no fileHash; their position was not copied`);
  }
  if (byHash.size > 0) await progress.bulkPut([...byHash.values()]);
  return byHash.size;
}

/** The progress an old episode row carries, or null if it was never played or positioned. */
export function legacyProgressOf(ep: StoredEpisode): Progress | null {
  const pos = ep.playbackPosition ?? 0;
  const at = ep.lastPlayedAt ?? 0;
  if (!(pos > 0) && !(at > 0)) return null;
  const out: Progress = { fileHash: ep.fileHash };
  if (pos > 0) out.playbackPosition = pos;
  if (at > 0) out.lastPlayedAt = at;
  return out;
}

/**
 * Fold two progress entries for one episode into one. Pure.
 *
 *   - lastPlayedAt: the later.
 *   - playbackPosition: from the entry played last, so "resume" resumes where
 *     the listener actually stopped — falling back to whichever has one.
 *
 * The same rule `absorbUserData` (./merge.ts) applies to episode rows.
 */
export function mergeProgress(a: Progress | undefined, b: Progress): Progress {
  if (!a) return { ...b };
  const aAt = a.lastPlayedAt ?? 0;
  const bAt = b.lastPlayedAt ?? 0;
  const out: Progress = { fileHash: a.fileHash };
  const at = Math.max(aAt, bAt);
  if (at > 0) out.lastPlayedAt = at;
  const position = bAt > aAt
    ? (b.playbackPosition ?? a.playbackPosition)
    : (a.playbackPosition ?? b.playbackPosition);
  if (position !== undefined) out.playbackPosition = position;
  return out;
}
