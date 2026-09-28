import type { Episode } from "@/db/schema";
import { db, deletePreference } from "@/db";
import { LAST_EPISODE_PREF } from "@/db/merge";
import { stopPlayerForLive } from "@/audio/live-session";
import { emit, onHdEvent } from "@/lib/events";
import { usePlayerStore } from "@/stores/player-store";
import { installLiveStation } from "@/audio/live-controller";
import { endBridge, playBridge, stopBridge } from "@/audio/engine";
import { currentStartPlan } from "@/audio/outage-gate";
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
    for (const ep of found) {
      rows.set(ep.fileHash, ep);
      adoptRow(ep);
    }
  } catch {
    /* no IndexedDB: slots stand in for rows */
  }
}

/**
 * The player is on a slot-made stand-in for `row`'s show: hand it the real row.
 *
 * A first-time listener tunes in before the library has finished seeding, so
 * the show on the air has no row yet and plays from its slot. That episode has
 * no id, and an episode without one is never saved as `last-episode-id` nor
 * written to history — a reload came back to an empty player, with nothing
 * for ▶ to resume. Same show, same file: only the object changes, so nothing
 * restarts and the station does not read it as the listener picking a show.
 */
function adoptRow(row: Episode): void {
  const cur = usePlayerStore.getState().currentEpisode;
  if (cur && cur.id == null && cur.fileHash === row.fileHash && row.id != null) {
    usePlayerStore.setState({ currentEpisode: row });
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

/** How much of the next show to fetch ahead: its first seconds at any bitrate here. */
export const PREFETCH_BYTES = 256 * 1024;

/**
 * Fetch the first bytes of `slot`'s show from wherever its start will go
 * (archive.org, or the mirror while archive.org is down), a minute before it
 * airs. It warms the path the element is about to take: archive.org's redirect
 * and storage node, or our mirror's slice cache. The bytes are thrown away.
 * Best effort: a failure here changes nothing.
 */
export async function prefetchSlotStart(slot: ProgramSlot, fetchImpl: typeof fetch = fetch): Promise<void> {
  const plan = currentStartPlan(rows.get(slot.fileHash) ?? episodeFromSlot(slot));
  if (plan.kind !== "play") return;
  try {
    const res = await fetchImpl(plan.source.url, {
      headers: { Range: `bytes=0-${PREFETCH_BYTES - 1}` },
      credentials: "omit",
      signal: AbortSignal.timeout(20_000),
    });
    await res.arrayBuffer();
  } catch {
    /* best effort */
  }
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
    // Leaving clears the show from the player and from what a reload restores:
    // the layout re-primes `last-episode-id` on every load, so without this
    // the station's show came back in the bottom player after a refresh.
    leavePlayer: () => {
      stopPlayerForLive();
      void deletePreference(LAST_EPISODE_PREF).catch(() => {});
    },
    // The bridge between shows is the player's own element (engine.ts).
    stationId: { start: playBridge, stop: endBridge, release: stopBridge },
    prefetch: (slot) => void prefetchSlotStart(slot),
  });
  const held = useLiveStore.getState().schedule;
  if (held) void prefetch(held);
  const offPrefetch = useLiveStore.subscribe((s, prev) => {
    if (s.schedule && s.schedule !== prev.schedule) void prefetch(s.schedule);
  });
  // The library seeds after the first schedule on a first visit: read again.
  const offSeed = onHdEvent("seed-settled", () => {
    const s = useLiveStore.getState().schedule;
    if (s) void prefetch(s);
  });
  return () => {
    offPrefetch();
    offSeed();
    offStation();
  };
}
