/** Shared formatting helpers used across components. */

/** Format seconds as "Xh Ym" or "Ym" */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * How big is this download, roughly.
 *
 * Shown next to the runtime so a long wait reads as expected rather than
 * broken. These are community rips at wildly varying bitrates — the catalog
 * spans 0.1MB to 268MB — so runtime alone does not predict the wait at all: a
 * three-hour show can be 25MB or 190MB depending on who ripped it.
 *
 * Deliberately coarse. Nobody needs "182.44 MB", and a number that precise
 * invites reading it as a progress figure.
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0 || !isFinite(bytes)) return "";
  const mb = bytes / 1_000_000;
  if (mb < 1) return "<1 MB";
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
}

/**
 * Past this, a cold start is slow enough that the player should say so early
 * rather than let the listener sit on a silent ▶ wondering. Chosen from the
 * catalog's own distribution: the median episode is 39MB and 95% are under
 * ~120MB, so this flags the genuine outliers — the 190MB and 268MB rips — and
 * not the ordinary three-hour show.
 */
export const LARGE_EPISODE_BYTES = 150_000_000;

/** Format seconds as "H:MM:SS" or "M:SS" */
export function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Format a YYYY-MM-DD air date as "Feb 11, 2007" */
export function formatAirDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Elapsed time as "just now" / "4m ago" / "3h ago" / "2d ago".
 *
 * Deliberately coarse: these labels sit beside a live count that refreshes on a
 * timer, and a second-by-second readout would make the whole panel look like it
 * was twitching. Clamps negatives to "just now" — a client clock a few seconds
 * ahead of the server should not produce "in 8 seconds".
 */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return "";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Get human-readable show label from showType field */
export function getShowLabel(showType?: string | null): string | null {
  if (showType === "coast") return "Coast to Coast AM";
  if (showType === "dreamland") return "Dreamland";
  if (showType === "special") return "Special";
  return null;
}
