import { db } from "@/db";
import { usePlayerStore } from "@/stores/player-store";
import { removeCachedAudio } from "@/audio/cache";
import { fetchWithRetry } from "@/lib/utils/retry";

export async function deleteEpisode(id: number): Promise<void> {
  const episode = await db.episodes.get(id);
  if (!episode) return;

  // Stop if currently playing
  const store = usePlayerStore.getState();
  if (store.currentEpisode?.id === id) {
    store.stop();
  }

  // Remove from queue
  const queueIdx = store.queue.findIndex((e) => e.id === id);
  if (queueIdx !== -1) {
    store.removeFromQueue(queueIdx);
  }

  // Remove OPFS cache
  try {
    await removeCachedAudio(episode.fileHash);
  } catch {
    // Ignore cache removal errors
  }

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
}

export async function deleteEpisodes(ids: number[]): Promise<void> {
  for (const id of ids) {
    await deleteEpisode(id);
  }
}

export async function toggleFavorite(id: number): Promise<boolean> {
  const episode = await db.episodes.get(id);
  if (!episode) return false;
  const isFav = !episode.favoritedAt;
  await db.episodes.update(id, {
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
  await db.episodes.update(id, {
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

export async function recategorizeEpisode(id: number): Promise<void> {
  const episode = await db.episodes.get(id);
  if (!episode) return;

  await db.episodes.update(id, { aiStatus: "pending", updatedAt: Date.now() });

  try {
    const res = await fetchWithRetry("/api/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.NEXT_PUBLIC_ADMIN_TOKEN ?? ""}` },
      body: JSON.stringify({
        episodes: [{
          title: episode.title ?? null,
          fileName: episode.fileName,
          airDate: episode.airDate ?? null,
          guestName: episode.guestName ?? null,
          description: episode.description ?? null,
          archiveIdentifier: episode.archiveIdentifier ?? null,
          source: episode.source ?? null,
          artist: episode.artist ?? null,
          topic: episode.topic ?? null,
          showType: episode.showType ?? null,
        }],
      }),
    }, { retries: 1 });

    if (!res.ok) {
      await db.episodes.update(id, { aiStatus: "failed", updatedAt: Date.now() });
      return;
    }

    const results = await res.json();
    if (Array.isArray(results) && results[0]) {
      const { title, summary, tags, topic, guestName, airDate, showType, category, series, seriesPart, notable } = results[0];
      await db.episodes.update(id, {
        title: title ?? episode.title,
        aiSummary: summary ?? undefined,
        aiTags: tags ?? undefined,
        aiCategory: category ?? undefined,
        aiSeries: series ?? undefined,
        aiSeriesPart: seriesPart ?? undefined,
        aiNotable: notable ?? false,
        topic: topic ?? episode.topic,
        guestName: guestName ?? episode.guestName,
        airDate: airDate ?? episode.airDate,
        showType: showType ?? episode.showType,
        aiStatus: "completed",
        updatedAt: Date.now(),
      });
    }
  } catch {
    await db.episodes.update(id, { aiStatus: "failed", updatedAt: Date.now() });
  }
}
