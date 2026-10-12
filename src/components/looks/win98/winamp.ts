/**
 * The Winamp window's readouts (WinampPlayer.tsx), kept pure for tests.
 */
import { formatTime } from "@/lib/utils/format";

/** The speeds the speed button steps through: the same list as PlaybackControls. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function nextRate(rate: number): number {
  const i = PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]);
  return PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
}

/** Two-digit field. */
const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");

/**
 * The LED clock: "mm:ss" (minutes grow past 59, as Winamp's did, so a
 * three-hour broadcast reads 172:05), or "-mm:ss" for the time remaining.
 */
export function ledTime(position: number, duration: number, remaining: boolean): string {
  const p = Number.isFinite(position) && position > 0 ? position : 0;
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const t = remaining && d > 0 ? Math.max(0, d - p) : p;
  const text = `${pad(t / 60)}:${pad(t % 60)}`;
  return remaining && d > 0 ? `-${text}` : text;
}

/** "1. Coast to Coast AM - Title (2:45:00)  ***  ", as Winamp scrolled it. */
export function marqueeText({ index, title, duration }: { index: number; title: string; duration: number }): string {
  const length = duration > 0 ? ` (${formatTime(duration)})` : "";
  return `${index + 1}. ${title}${length}  ***  `;
}

/**
 * The kbps and kHz readouts: the episode's own figures where the catalog has
 * them, else the common rip's (cosmetic, as the look allows).
 */
export function streamReadout(ep: { bitrate?: number; sampleRate?: number }): { kbps: string; khz: string; mono: boolean } {
  const kbps = ep.bitrate && ep.bitrate > 0 ? Math.round(ep.bitrate) : 64;
  const hz = ep.sampleRate && ep.sampleRate > 0 ? ep.sampleRate : 44_100;
  return { kbps: String(kbps), khz: String(Math.round(hz / 1000)), mono: kbps <= 64 };
}
