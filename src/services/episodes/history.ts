import { db } from "@/db";
import type { Episode } from "@/db/schema";
import { episodeTitle } from "@/lib/library/display-title";

/**
 * The one writer of a new Listening History row (2026-10-31).
 *
 * The layout used to add a row whenever the player's episode id changed, and
 * restoring the remembered show on a page load is such a change (none → id).
 * So every visit, reload and update-reload logged the same show again: /stats
 * read "Philadelphia Experiment" six times in one day for one listen.
 *
 * Now a show that is already the newest row, on the same local day, keeps that
 * row (the listened seconds keep going into it: `flushListenSeconds`). Another
 * show, or the same one on a later day, is a new row.
 */
export async function recordHistory(ep: Episode, now: number = Date.now()): Promise<void> {
  if (!ep.id) return;
  await db.transaction("rw", db.history, async () => {
    const newest = await db.history.orderBy("timestamp").last();
    if (newest && newest.episodeId === ep.id && sameLocalDay(newest.timestamp, now)) return;
    await db.history.add({
      episodeId: ep.id!,
      timestamp: now,
      duration: 0,
      episodeTitle: episodeTitle(ep),
      guestName: ep.guestName,
    });
  });
}

export function sameLocalDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * Rows for display, newest first: back-to-back rows of one show on one day are
 * shown once (the newest). Libraries written before `recordHistory` hold a row
 * per page load; this is what keeps them from reading as repeats.
 */
export function foldRepeats<T extends { episodeId: number; timestamp: number }>(newestFirst: T[]): T[] {
  const out: T[] = [];
  for (const entry of newestFirst) {
    const prev = out[out.length - 1];
    if (prev && prev.episodeId === entry.episodeId && sameLocalDay(prev.timestamp, entry.timestamp)) continue;
    out.push(entry);
  }
  return out;
}
