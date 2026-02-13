/** Shared formatting helpers used across components. */

/** Format seconds as "Xh Ym" or "Ym" */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

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

/** Get human-readable show label from showType field */
export function getShowLabel(showType?: string | null): string | null {
  if (showType === "coast") return "Coast to Coast AM";
  if (showType === "dreamland") return "Dreamland";
  if (showType === "special") return "Special";
  return null;
}
