/**
 * Listening streak: consecutive days (ending today or yesterday) that have at
 * least one history entry.
 *
 * Today not yet having an entry does not break the streak — a streak is only
 * broken by a fully missed day before today.
 *
 * Extracted from three near-identical copies (DesktopShell, stats page,
 * ListeningStats) which had already drifted apart: one of them capped history
 * at 500 entries and so could report a different number than the other two.
 */

const MAX_STREAK_DAYS = 365;

/** Local-time YYYY-MM-DD. Uses local date parts, not toISOString(), which is UTC. */
export function dayKey(timestamp: number | Date): string {
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function computeStreak(
  entries: { timestamp: number }[] | undefined | null,
  now: Date = new Date(),
): number {
  if (!entries || entries.length === 0) return 0;

  const daySet = new Set<string>();
  for (const entry of entries) daySet.add(dayKey(entry.timestamp));

  let count = 0;
  for (let d = 0; d < MAX_STREAK_DAYS; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    if (daySet.has(dayKey(date))) {
      count++;
    } else if (d === 0) {
      continue; // today hasn't been listened to yet — check yesterday
    } else {
      break;
    }
  }
  return count;
}
