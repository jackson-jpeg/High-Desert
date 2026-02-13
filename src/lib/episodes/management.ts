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
        }],
      }),
    }, { retries: 1 });

    if (!res.ok) {
      await db.episodes.update(id, { aiStatus: "failed", updatedAt: Date.now() });
      return;
    }

    const results = await res.json();
    if (Array.isArray(results) && results[0]) {
      const { summary, tags, topic, guestName, airDate, showType } = results[0];
      await db.episodes.update(id, {
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
