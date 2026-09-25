import type { Episode } from "@/db/schema";
import { db } from "@/db";
import { emit } from "@/lib/events";
import { installLiveStation } from "@/audio/live-controller";
import {
  prepareStationId,
  releaseStationId,
  startStationId,
  stopStationId,
} from "@/audio/station-id";
import { fetchServerNow } from "@/lib/live/time-sync";
import { knownSlots, type LiveSchedule, type ProgramSlot } from "@/lib/live/schedule";
import { useLiveStore } from "@/stores/live-store";

/**
 * The live station's real wiring, for the desktop layout: the schedule and
 * clock routes, the ordinary play path (`hd:play-episode`, answered by the
 * layout on every route), the listener's own library rows, and the AM static.
 */

/**
 * The listener's own row for each scheduled show, read ahead of time.
 *
 * Tuning in happens inside a tap, and `play()` must follow it without an
 * await (Safari decides otherwise that the call was not user-initiated), so
 * the Episode cannot be read from IndexedDB at that moment. The rows of every
 * slot the schedule knows are read whenever a new schedule arrives. A show
 * missing from the library — a visitor who deleted it — is played from a row
 * made from the slot itself.
 */
const rows = new Map<string, Episode>();

async function prefetch(schedule: LiveSchedule): Promise<void> {
  const hashes = knownSlots(schedule)
    .map((s) => s.fileHash)
    .filter((h) => !rows.has(h));
  if (hashes.length === 0) return;
  try {
    const found = await db.episodes.where("fileHash").anyOf(hashes).toArray();
    for (const ep of found) rows.set(ep.fileHash, ep);
  } catch {
    /* no IndexedDB: slots stand in for rows */
  }
}

/** An Episode for a slot the library does not hold. Never saved anywhere. */
export function episodeFromSlot(slot: ProgramSlot): Episode {
  // fileHash is `archive:{identifier}:{fileName}` (src/db/identity.ts).
  const [, identifier = "", ...rest] = slot.fileHash.split(":");
  const fileName = rest.join(":");
  return {
    fileHash: slot.fileHash,
    fileName,
    filePath: slot.sourceUrl ?? "",
    fileSize: 0,
    title: slot.title,
    airDate: slot.airDate ?? undefined,
    guestName: slot.guestName ?? undefined,
    showType: (slot.showType as Episode["showType"]) ?? undefined,
    duration: slot.duration,
    sourceUrl: slot.sourceUrl ?? undefined,
    source: "archive",
    archiveIdentifier: identifier || undefined,
    createdAt: 0,
    updatedAt: 0,
  };
}

async function fetchSchedule(): Promise<LiveSchedule | null> {
  try {
    const res = await fetch("/api/live/schedule", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as LiveSchedule;
  } catch {
    return null;
  }
}

export function installBrowserLiveStation(): () => void {
  const offStation = installLiveStation({
    fetchSchedule,
    fetchServerNow,
    startEpisode: (episode) => emit("play-episode", episode),
    resolveEpisode: (slot) => rows.get(slot.fileHash) ?? episodeFromSlot(slot),
    stationId: {
      prepare: prepareStationId,
      start: startStationId,
      stop: stopStationId,
      release: releaseStationId,
    },
  });
  const held = useLiveStore.getState().schedule;
  if (held) void prefetch(held);
  const offPrefetch = useLiveStore.subscribe((s, prev) => {
    if (s.schedule && s.schedule !== prev.schedule) void prefetch(s.schedule);
  });
  return () => {
    offPrefetch();
    offStation();
  };
}
