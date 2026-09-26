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

/**
 * "Coast to Coast AM - September 11th Coverage" → show "Coast to Coast AM",
 * episode "September 11th Coverage". The catalog's titles lead with the show,
 * which made the studio's heading read the same for every Coast broadcast; the
 * episode is the heading and the show goes in the kicker. A title with no
 * " - " is all episode.
 */
export function splitShowTitle(title: string): { show: string | null; episode: string } {
  const at = title.indexOf(" - ");
  if (at <= 0 || at + 3 >= title.length) return { show: null, episode: title };
  return { show: title.slice(0, at), episode: title.slice(at + 3) };
}
