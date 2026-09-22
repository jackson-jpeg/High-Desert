import { db } from "@/db";
import { usePlayerStore } from "@/stores/player-store";
import { removeCachedAudio } from "@/audio/cache";
import { addTombstone, resetSeedMarkers } from "@/db/seed";
import { QUEUE_IDS_PREF, LAST_EPISODE_PREF } from "@/db/merge";

export async function deleteEpisode(id: number): Promise<void> {
  const episode = await db.episodes.get(id);
  if (!episode) return;

  // Stop if currently playing
  if (usePlayerStore.getState().currentEpisode?.id === id) {
    usePlayerStore.getState().stop();
  }

  // Re-read rather than reusing the snapshot above: stop() clears the queue, so
  // a `queue` captured before it is stale by the time we index into it. That was
  // harmless only by coincidence — removeFromQueue happens to bounds-check and
  // return early against the now-empty live queue — and a coincidence with a
  // test around it is not a property. Read the state you are about to act on.
  const { queue, removeFromQueue } = usePlayerStore.getState();
  const queueIdx = queue.findIndex((e) => e.id === id);
  if (queueIdx !== -1) {
    removeFromQueue(queueIdx);
  }

  // ONE transaction over every table the delete writes (HD-025). It used to be
  // six separate writes, so a failure after the first left an episode gone with
  // its history, bookmarks and playlist slots pointing at nothing — or, worse,
  // a tombstone for a show that was never actually deleted, which would hide a
  // catalog row from reconcile forever. Now it is all of it or none of it.
  await db.transaction("rw", [db.episodes, db.history, db.bookmarks, db.playlists, db.userPrefs], async () => {
    // Remember the deletion so reconcileLibrary() won't restore it later
    await addTombstone(episode.fileHash);

    // Delete from Dexie
    await db.episodes.delete(id);

    // Cascade: remove related history and bookmarks
    await db.history.where("episodeId").equals(id).delete();
    await db.bookmarks.where("episodeId").equals(id).delete();

    // Remove from any playlists
    const playlists = await db.playlists.toArray();
    for (const pl of playlists) {
      if (pl.episodeIds.includes(id)) {
        await db.playlists.update(pl.id!, {
          episodeIds: pl.episodeIds.filter((eid) => eid !== id),
          updatedAt: Date.now(),
        });
      }
    }
  });

  // Remove the OPFS cache only once the delete has committed. It is not
  // IndexedDB, so it cannot join the transaction — and if the transaction
  // failed, the episode is still here and its cached audio is still wanted.
  try {
    await removeCachedAudio(episode.fileHash);
  } catch {
    // Ignore cache removal errors
  }
}

export async function deleteEpisodes(ids: number[]): Promise<void> {
  for (const id of ids) {
    await deleteEpisode(id);
  }
}

/** Preferences whose values point into the library; cleared with it. */
const LIBRARY_PREFS = [QUEUE_IDS_PREF, "queue-index", LAST_EPISODE_PREF, "scraper-page", "seed-heal-refused"];

/**
 * "Clear Library": every episode, and everything that points at one.
 *
 * It used to clear `episodes` and `scanSessions` only, leaving history,
 * bookmarks and playlists referencing ids that no longer existed, and a saved
 * queue that restored nothing (HD-025). Everything now goes in ONE rw
 * transaction, so a failure part-way leaves the library exactly as it was
 * rather than half-cleared.
 *
 * The tombstones and the reconcile marker are reset in the same transaction,
 * so the catalog re-seeds cleanly on the next load. Unrelated preferences —
 * volume, text size, visualiser — are kept.
 *
 * User-initiated and confirmed only (ClearLibraryDialog). See the data-safety
 * notes in CLAUDE.md before calling this from anywhere else.
 */
export async function clearLibrary(): Promise<void> {
  // The player holds episode objects in memory and persists its queue on every
  // change; stop it first so nothing is written back pointing at a cleared row.
  usePlayerStore.getState().stop();

  await db.transaction("rw", [db.episodes, db.scanSessions, db.history, db.bookmarks, db.playlists, db.userPrefs], async () => {
    await db.episodes.clear();
    await db.scanSessions.clear();
    await db.history.clear();
    await db.bookmarks.clear();
    await db.playlists.clear();
    await db.userPrefs.where("key").anyOf(LIBRARY_PREFS).delete();
    await resetSeedMarkers();
  });
}

/**
 * Applies field changes to one episode, treating `undefined` as "remove this
 * field" rather than "leave it alone".
 *
 * **This is not a workaround.** The docblock here used to say Dexie's
 * `Table.update()` silently ignores keys whose value is `undefined`. It does
 * not: `Table.prototype.update` delegates to `.where(":id").equals(key)
 * .modify(mods)` — the exact call below — and `modify` deletes any key set to
 * `undefined`. Verified against the installed 4.3.0, which is the only version
 * this project has ever resolved. See `docs/dexie-update-semantics.md`.
 *
 * It stays because it says what it means. `update(id, { favoritedAt: undefined
 * })` reads to most people as "leave that alone", which is what someone assumed,
 * wrote down as fact, and got into three files; and because all user data lives
 * only in the visitor's IndexedDB with no server backup, so a future major
 * version changing its mind about `undefined` is not something to find out from
 * a bug report. It is not load-bearing — `update()` would work.
 *
 * Scoped to a single row by primary key, and only ever called from a user
 * action. See the data-safety notes in CLAUDE.md before widening this.
 */
async function applyEpisodeFields(
  id: number,
  changes: Record<string, unknown>,
): Promise<void> {
  await db.episodes
    .where(":id")
    .equals(id)
    .modify((ep) => {
      const row = ep as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) {
          delete row[key];
        } else {
          row[key] = value;
        }
      }
    });
}

export async function toggleFavorite(id: number): Promise<boolean> {
  const episode = await db.episodes.get(id);
  if (!episode) return false;
  const isFav = !episode.favoritedAt;
  await applyEpisodeFields(id, {
    favoritedAt: isFav ? Date.now() : undefined,
    updatedAt: Date.now(),
  });
  return isFav;
}

export async function updateEpisode(
  id: number,
  fields: Partial<Pick<import("@/db/schema").Episode, "title" | "guestName" | "airDate" | "topic" | "showType" | "aiSummary" | "aiCategory" | "aiSeries" | "aiSeriesPart" | "aiNotable">>,
): Promise<void> {
  await db.episodes.update(id, { ...fields, updatedAt: Date.now() });
}

export async function rateEpisode(id: number, rating: number | undefined): Promise<void> {
  await applyEpisodeFields(id, {
    rating: rating && rating >= 1 && rating <= 5 ? rating : undefined,
    updatedAt: Date.now(),
  });
}

export async function addBookmark(
  episodeId: number,
  position: number,
  label: string,
): Promise<number | undefined> {
  return db.bookmarks.add({
    episodeId,
    position,
    label,
    createdAt: Date.now(),
  });
}

export async function removeBookmark(id: number): Promise<void> {
  await db.bookmarks.delete(id);
}

export async function getBookmarks(episodeId: number) {
  return db.bookmarks.where("episodeId").equals(episodeId).sortBy("position");
}

export async function toggleFlag(id: number): Promise<boolean> {
  const episode = await db.episodes.get(id);
  if (!episode) return false;
  const isFlagged = !episode.flaggedAt;
  await applyEpisodeFields(id, {
    flaggedAt: isFlagged ? Date.now() : undefined,
    updatedAt: Date.now(),
  });
  return isFlagged;
}

/** Add episodes to a playlist, skipping ones already present. */
export async function addToPlaylist(playlistId: number, episodeIds: number[]): Promise<void> {
  const playlist = await db.playlists.get(playlistId);
  if (!playlist) return;
  const existing = new Set(playlist.episodeIds);
  const newIds = [...playlist.episodeIds, ...episodeIds.filter((id) => !existing.has(id))];
  await db.playlists.update(playlistId, { episodeIds: newIds, updatedAt: Date.now() });
}
