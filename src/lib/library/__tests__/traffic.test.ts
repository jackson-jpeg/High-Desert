import { describe, it, expect } from "vitest";
import type { HourBucket, TrafficPoint } from "@/services/stats/client";
import {
  buildGeometry,
  buildHourProfile,
  hourBarPercent,
  hourLabel,
  isNightHour,
  CHART_W,
  CHART_H,
  CHART_PAD_Y,
} from "@/lib/library/traffic";

/**
 * The Signal Traffic panel's data shaping, on numbers. Dates are built with
 * the *local* Date constructor, because night shading is a local-time notion;
 * that keeps these tests true in any TZ the suite runs under.
 */

function pt(hourLocal: number, v: Partial<TrafficPoint> = {}, day = 10): TrafficPoint {
  const online = v.online ?? 0;
  const listening = v.listening ?? 0;
  return {
    t: new Date(2026, 8, day, hourLocal, 0, 0).toISOString(),
    online,
    listening,
    // A bucket whose samples were all equal: max = mean, unless a test says otherwise.
    onlineMax: online,
    listeningMax: listening,
    plays: 0,
    ...v,
  };
}

/** A contiguous hourly series starting at `fromHour` local, wrapping past midnight. */
function series(fromHour: number, count: number, v: (i: number) => Partial<TrafficPoint> = () => ({})): TrafficPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const h = fromHour + i;
    return pt(h % 24, v(i), 10 + Math.floor(h / 24));
  });
}

describe("buildGeometry", () => {
  it("draws nothing for fewer than two points", () => {
    expect(buildGeometry([], "24h")).toBeNull();
    expect(buildGeometry([pt(12)], "24h")).toBeNull();
  });

  it("puts presence and plays on separate scales", () => {
    // Plays spike to 20 while presence sits at 2. On one shared axis the
    // presence line would be pinned to the floor.
    const pts = series(12, 3, (i) => ({ online: i === 1 ? 2 : 1, plays: i === 1 ? 20 : 0 }));
    const geo = buildGeometry(pts, "24h")!;
    expect(geo.peakPresence).toBe(2);
    expect(geo.peakPlays).toBe(20);
    // The peak presence point reaches the top padding, not a tenth of the way up.
    expect(geo.yPresence(2)).toBeCloseTo(CHART_PAD_Y);
    expect(geo.yPresence(0)).toBeCloseTo(CHART_H - CHART_PAD_Y);
  });

  it("draws each bucket's max as the main line and its mean as the fainter one", () => {
    // A two-minute burst of 10 in a bucket whose mean is 1. Drawing the mean
    // (as the chart did) put the busiest moment of the day at 1.
    const pts = series(12, 3, (i) => ({
      online: 1,
      onlineMax: i === 1 ? 10 : 1,
      listening: 0,
      listeningMax: i === 1 ? 6 : 0,
    }));
    const geo = buildGeometry(pts, "24h")!;
    expect(geo.peakPresence).toBe(10);
    const at = (d: string, i: number) => d.split(" ")[i].slice(1).split(",").map(Number)[1];
    expect(at(geo.online, 1)).toBeCloseTo(geo.yPresence(10), 1);
    expect(at(geo.listening, 1)).toBeCloseTo(geo.yPresence(6), 1);
    expect(at(geo.onlineAvg, 1)).toBeCloseTo(geo.yPresence(1), 1);
    expect(at(geo.listeningAvg, 1)).toBeCloseTo(geo.yPresence(0), 1);
    // The shaded area sits under the max line, not the mean.
    expect(geo.area.startsWith(geo.online)).toBe(true);
  });

  it("never divides by a zero peak", () => {
    const geo = buildGeometry(series(12, 2), "24h")!;
    expect(geo.peakPresence).toBe(1);
    expect(geo.peakPlays).toBe(1);
    expect(geo.online).not.toContain("NaN");
  });

  it("spans the full width and closes the area under the online line", () => {
    const geo = buildGeometry(series(12, 3, () => ({ online: 1, listening: 1 })), "24h")!;
    expect(geo.x(0)).toBe(0);
    expect(geo.x(2)).toBe(CHART_W);
    expect(geo.online.startsWith("M0.0,")).toBe(true);
    expect(geo.area).toBe(`${geo.online} L${CHART_W},${CHART_H} L0,${CHART_H} Z`);
  });

  it("merges a contiguous night run into one band", () => {
    // 20:00 .. 08:00 local: 22,23,0..5 are night — one run of eight buckets.
    const geo = buildGeometry(series(20, 13), "24h")!;
    expect(geo.nightBands).toHaveLength(1);
    const step = CHART_W / 12;
    expect(geo.nightBands[0].x).toBeCloseTo(2 * step);
    expect(geo.nightBands[0].w).toBeCloseTo(7 * step);
  });

  it("has no night band for an afternoon", () => {
    expect(buildGeometry(series(12, 6), "24h")!.nightBands).toEqual([]);
  });

  it("never repeats a tick label", () => {
    // Three hours at 15-minute buckets: the five ticks land at 19:00, 19:45,
    // 20:30, 21:15 and 22:00, and hour-resolution labels read "7 PM" twice.
    const base = new Date(2026, 8, 10, 19, 0, 0).getTime();
    const pts = Array.from({ length: 13 }, (_, i) => ({
      t: new Date(base + i * 15 * 60_000).toISOString(),
      online: 1,
      listening: 0,
      onlineMax: 1,
      listeningMax: 0,
      plays: 0,
    }));
    const labels = buildGeometry(pts, "24h")!.ticks.map((t) => t.label);
    expect(labels).toHaveLength(4);
    expect(new Set(labels).size).toBe(labels.length);

    const coarse = buildGeometry(series(12, 5), "30d")!.ticks.map((t) => t.label);
    expect(new Set(coarse).size).toBe(coarse.length);
    expect(coarse.length).toBeGreaterThan(0);
  });

  it("caps the play column width", () => {
    expect(buildGeometry(series(12, 2), "24h")!.barW).toBe(28);
    expect(buildGeometry(series(0, 100), "7d")!.barW).toBeCloseTo((CHART_W / 100) * 0.6);
  });
});

function hb(hour: number, online: number, samples = 1, plays = 0): HourBucket {
  return { hour, online, listening: 0, plays, samples };
}

describe("buildHourProfile", () => {
  it("rotates UTC hours into local hours", () => {
    // getTimezoneOffset() is -120 two hours *east* of UTC: 00 UTC is 02 local.
    const p = buildHourProfile([hb(0, 5)], -120);
    expect(p.bars[2]).toEqual({ online: 5, plays: 0, samples: 1 });
    expect(p.bars[0].samples).toBe(0);
  });

  it("wraps west of UTC into the previous day's hours", () => {
    // 300 = UTC-5: 02 UTC is 21 local.
    const p = buildHourProfile([hb(2, 3)], 300);
    expect(p.bars[21].online).toBe(3);
  });

  it("counts covered hours and finds the busiest", () => {
    const p = buildHourProfile([hb(1, 1), hb(3, 4), hb(5, 4)], 0);
    expect(p.covered).toBe(3);
    expect(p.busiest).toBe(3); // earliest of a tie
    expect(p.peak).toBe(4);
    expect(p.bars).toHaveLength(24);
  });

  it("keeps an all-zero profile's peak positive", () => {
    expect(buildHourProfile([], 0).peak).toBeGreaterThan(0);
  });
});

describe("hourBarPercent", () => {
  it("draws a never-sampled hour lower than a watched empty one", () => {
    const unseen = hourBarPercent({ online: 0, plays: 0, samples: 0 }, 4);
    const empty = hourBarPercent({ online: 0, plays: 0, samples: 3 }, 4);
    expect(unseen).toBe(3);
    expect(empty).toBe(4);
    expect(hourBarPercent({ online: 2, plays: 0, samples: 3 }, 4)).toBe(50);
  });
});

describe("labels", () => {
  it("formats compact hour labels", () => {
    expect([0, 6, 12, 18, 23].map(hourLabel)).toEqual(["12a", "6a", "12p", "6p", "11p"]);
  });

  it("treats 22:00 to 05:59 as night", () => {
    expect([21, 22, 0, 5, 6].map(isNightHour)).toEqual([false, true, true, true, false]);
  });
});
