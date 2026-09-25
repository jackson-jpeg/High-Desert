import { STATION_TZ } from "./schedule";

/**
 * Formatting for the live station. Station times are shown in Pacific — the
 * station's own clock, the one the day turns over on — and labelled "PT", so a
 * listener in London is not left wondering why the program starts at 8 AM.
 */

let clock: Intl.DateTimeFormat | null = null;

/** "2:14 AM" in Pacific time. */
export function formatStationTime(ms: number): string {
  clock ??= new Intl.DateTimeFormat("en-US", {
    timeZone: STATION_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
  return clock.format(new Date(ms));
}

/** "1:12:04" or "12:04" — a countdown, never negative. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** "2h 40m" — a slot's length in the guide. */
export function formatLength(seconds: number): string {
  const m = Math.round(seconds / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
