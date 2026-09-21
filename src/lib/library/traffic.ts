import type { HourBucket, TrafficPoint } from "@/services/stats/client";

/**
 * Pure data shaping for the Signal Traffic panel (HD-018): everything that
 * turns an API answer into chart geometry and labels, with no React and no
 * DOM, so it can be tested on numbers rather than on pixels.
 */

export type TrafficRange = "24h" | "7d" | "30d";

export const TRAFFIC_RANGES: { key: TrafficRange; label: string; short: string }[] = [
  { key: "24h", label: "24 hours", short: "24h" },
  { key: "7d", label: "7 days", short: "7d" },
  { key: "30d", label: "30 days", short: "30d" },
];

/** SVG viewBox of the history chart; it is stretched to the panel width. */
export const CHART_W = 600;
export const CHART_H = 150;
export const CHART_PAD_Y = 6;

/** Local hours treated as "night" — the shaded band, and Art Bell's shift. */
export const NIGHT_FROM = 22;
export const NIGHT_TO = 6;

/** Hours that must have been observed before the hour profile means anything. */
export const MIN_HOURS_COVERED = 8;

export function isNightHour(hour: number): boolean {
  return hour >= NIGHT_FROM || hour < NIGHT_TO;
}

export function isNight(d: Date): boolean {
  return isNightHour(d.getHours());
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Axis label for a tick.
 *
 * `spanHours` matters because the range is a *window*, not a guarantee of
 * content: a sampler that started forty minutes ago answers a 24h request with
 * forty minutes of data, and hour-granularity labels then read "7 PM, 7 PM,
 * 7 PM". The label resolution follows what is actually on screen.
 */
export function formatTick(d: Date, range: TrafficRange, spanHours: number): string {
  if (spanHours < 3) return formatClock(d);
  if (range === "24h" || spanHours < 30) {
    return d.toLocaleTimeString([], { hour: "numeric" });
  }
  if (range === "7d" || spanHours < 24 * 10) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatStamp(d: Date, range: TrafficRange): string {
  if (range === "24h") return formatClock(d);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${formatClock(d)}`;
}

/** "12a", "6a", "12p" — compact enough for 24 columns on a phone. */
export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? "a" : "p"}`;
}

// ---------------------------------------------------------------------------
// History chart geometry
// ---------------------------------------------------------------------------

export interface TrafficGeometry {
  x: (i: number) => number;
  yPresence: (v: number) => number;
  peakPresence: number;
  peakPlays: number;
  online: string;
  listening: string;
  area: string;
  nightBands: { x: number; w: number }[];
  ticks: { i: number; label: string }[];
  /** Slot width for the play columns. */
  barW: number;
}

export function buildGeometry(points: TrafficPoint[], range: TrafficRange): TrafficGeometry | null {
  if (points.length < 2) return null;

  const W = CHART_W;
  const H = CHART_H;
  const PAD_Y = CHART_PAD_Y;
  const dates = points.map((p) => new Date(p.t));

  // Two scales on purpose. Presence is a gauge that sits in the low single
  // digits; plays is a counter that can spike to dozens in one bucket. Sharing
  // one axis — as this chart used to — pinned the presence lines flat against
  // the floor on exactly the days worth looking at.
  const peakPresence = Math.max(1, ...points.map((p) => Math.max(p.online, p.listening)));
  const peakPlays = Math.max(1, ...points.map((p) => p.plays));

  const stepX = W / (points.length - 1);
  const x = (i: number) => i * stepX;
  const yPresence = (v: number) => H - PAD_Y - (v / peakPresence) * (H - PAD_Y * 2);

  const line = (key: "online" | "listening") =>
    points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yPresence(p[key]).toFixed(1)}`)
      .join(" ");

  const online = line("online");
  const area = `${online} L${W},${H} L0,${H} Z`;

  // Contiguous runs of night buckets, merged into single rects so the shading
  // reads as one band rather than a picket fence of per-bucket stripes.
  const nightBands: { x: number; w: number }[] = [];
  let runStart = -1;
  dates.forEach((d, i) => {
    const night = isNight(d);
    if (night && runStart < 0) runStart = i;
    if ((!night || i === dates.length - 1) && runStart >= 0) {
      const end = night ? i : i - 1;
      nightBands.push({ x: x(runStart), w: Math.max(stepX, x(end) - x(runStart)) });
      runStart = -1;
    }
  });

  const spanHours =
    (dates[dates.length - 1].getTime() - dates[0].getTime()) / 3_600_000;

  const tickCount = Math.min(5, points.length);
  const seen = new Set<string>();
  const ticks = Array.from({ length: tickCount }, (_, k) => {
    const i = Math.round((k * (points.length - 1)) / (tickCount - 1 || 1));
    return { i, label: formatTick(dates[i], range, spanHours) };
  }).filter((t) => {
    // Two ticks with the same label are worse than one: they read as a broken
    // axis rather than as coarse resolution.
    if (seen.has(t.label)) return false;
    seen.add(t.label);
    return true;
  });

  return {
    x,
    yPresence,
    peakPresence,
    peakPlays,
    online,
    listening: line("listening"),
    area,
    nightBands,
    ticks,
    // Leave a gap between columns so they read as discrete buckets rather than
    // one continuous block, and cap the width when there are very few points.
    barW: Math.min(28, (W / points.length) * 0.6),
  };
}

// ---------------------------------------------------------------------------
// Hour-of-day profile
// ---------------------------------------------------------------------------

export interface HourBar {
  online: number;
  plays: number;
  samples: number;
}

export interface HourProfileData {
  /** 24 bars indexed by *local* hour. */
  bars: HourBar[];
  peak: number;
  /** Hours with at least one sample. */
  covered: number;
  /** Local hour with the highest average online count (earliest on a tie). */
  busiest: number;
}

/**
 * Rotate the API's UTC hour profile into the visitor's local hours.
 *
 * The API answers in UTC hours; the question a visitor is asking is about
 * their own night. Whole-hour offsets cover all but a handful of zones,
 * which land in the nearest hour rather than being dropped.
 *
 * `timezoneOffsetMinutes` is `Date#getTimezoneOffset()` — positive *west* of
 * UTC, which is why it is negated.
 */
export function buildHourProfile(hourly: HourBucket[], timezoneOffsetMinutes: number): HourProfileData {
  const offset = -Math.round(timezoneOffsetMinutes / 60);
  const bars: HourBar[] = Array.from({ length: 24 }, () => ({
    online: 0,
    plays: 0,
    samples: 0,
  }));
  for (const b of hourly) {
    const local = (((b.hour + offset) % 24) + 24) % 24;
    bars[local] = { online: b.online, plays: b.plays, samples: b.samples };
  }
  return {
    bars,
    peak: Math.max(0.01, ...bars.map((b) => b.online)),
    covered: bars.filter((b) => b.samples > 0).length,
    busiest: bars.reduce((best, b, i) => (b.online > bars[best].online ? i : best), 0),
  };
}

/**
 * Height of one hour column, in percent. An hour never sampled gets a
 * floor-level dash, visibly different from an hour that was watched and found
 * empty.
 */
export function hourBarPercent(bar: HourBar, peak: number): number {
  return bar.samples === 0 ? 3 : Math.max(4, (bar.online / peak) * 100);
}
