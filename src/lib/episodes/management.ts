import { db } from "@/lib/db";
import { usePlayerStore } from "@/stores/player-store";
import { removeCachedAudio } from "@/lib/audio/cache";
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
  fields: Partial<Pick<import("@/lib/db/schema").Episode, "title" | "guestName" | "airDate" | "topic" | "showType" | "aiSummary">>,
): Promise<void> {
  await db.episodes.update(id, { ...fields, updatedAt: Date.now() });
}

export async function recategorizeEpisode(id: number): Promise<void> {
  const episode = await db.episodes.get(id);
  if (!episode) return;

  await db.episodes.update(id, { aiStatus: "pending", updatedAt: Date.now() });

  try {
    const res = await fetchWithRetry("/api/categorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodes: [{
          title: episode.title,
          fileName: episode.fileName,
          airDate: episode.airDate,
          guestName: episode.guestName,
          description: episode.description,
          archiveIdentifier: episode.archiveIdentifier,
          source: episode.source,
          artist: episode.artist,
          topic: episode.topic,
          showType: episode.showType,
        }],
      }),
    }, { retries: 1 });

    if (!res.ok) {
      await db.episodes.update(id, { aiStatus: "failed", updatedAt: Date.now() });
      return;
    }

    const results = await res.json();
    if (Array.isArray(results) && results[0]) {
      const { title, summary, tags, topic, guestName, airDate, showType } = results[0];
      await db.episodes.update(id, {
        title: title ?? episode.title,
        aiSummary: summary ?? undefined,
        aiTags: tags ?? undefined,
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
