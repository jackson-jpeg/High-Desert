import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { episodeTitle } from "@/lib/library/display-title";

/**
 * Listening History: written by listening, never by a page load (2026-11-27,
 * UI plan push 6).
 *
 * The layout used to add a row whenever the player's episode id changed, and
 * restoring the remembered show on a page load is such a change (none → id).
 * 2026-10-31 stopped the repeats on one day; the row itself stayed, so a
 * visit that heard nothing still put a show in the history and a day in the
 * streak, while Listened (heard seconds) said 0.0h. Now the only writer is
 * `addListened`, called with seconds actually heard (listen-time.ts), and the
 * newest row of the same show on the same local day takes the seconds;
 * another show, or the same one on a later day, is a new row.
 */
export async function addListened(
  ep: Pick<Episode, "id" | "title" | "fileName" | "guestName">,
  seconds: number,
  now: number = Date.now(),
): Promise<void> {
  if (!ep.id || !(seconds > 0)) return;
  await db.transaction("rw", db.history, async () => {
    const newest = await db.history.orderBy("timestamp").last();
    if (newest && newest.episodeId === ep.id && sameLocalDay(newest.timestamp, now)) {
      await db.history.update(newest.id!, { duration: (newest.duration ?? 0) + seconds });
      return;
    }
    await db.history.add({
      episodeId: ep.id!,
      timestamp: now,
      duration: seconds,
      episodeTitle: episodeTitle(ep as Episode),
      guestName: ep.guestName,
    });
  });
}

export function sameLocalDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export { LISTEN_MIN_S, realListens, groupListens, type ListenGroup } from "@/lib/stats/listens";
