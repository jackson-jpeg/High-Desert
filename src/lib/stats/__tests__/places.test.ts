import { describe, it, expect } from "vitest";
import {
  US_TILES,
  US_TILE_COLS,
  US_TILE_ROWS,
  agoLabel,
  countsByCode,
  dayLabel,
  defaultPeriod,
  placeLabel,
  placedCount,
  placedNote,
  splitKnown,
  tileTier,
} from "../places";
import { US_STATES } from "@/lib/geo/places";

describe("the Listeners panel's arithmetic", () => {
  it("the tile map has every state and DC once, each in its own cell, inside the grid", () => {
    const codes = US_TILES.map(([c]) => c);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual(Object.values(US_STATES).sort());
    const cells = new Set(US_TILES.map(([, c, r]) => `${c},${r}`));
    expect(cells.size).toBe(US_TILES.length);
    for (const [, c, r] of US_TILES) {
      expect(c).toBeLessThan(US_TILE_COLS);
      expect(r).toBeLessThan(US_TILE_ROWS);
    }
  });

  it("tiers: nobody is 0, the busiest is 4, and the scale is square-root", () => {
    expect(tileTier(0, 100)).toBe(0);
    expect(tileTier(100, 100)).toBe(4);
    expect(tileTier(1, 100)).toBe(1); // sqrt(.01) = .1
    expect(tileTier(10, 100)).toBe(2); // sqrt(.1) ≈ .32
    expect(tileTier(36, 100)).toBe(3); // .6
    expect(tileTier(5, 0)).toBe(0);
  });

  it("counts by code drop the unknown state and add duplicates", () => {
    const m = countsByCode([{ code: "CA", n: 3 }, { code: null, n: 9 }, { code: "CA", n: 1 }, { code: "NV", n: 2 }]);
    expect([...m]).toEqual([["CA", 4], ["NV", 2]]);
  });

  it("splitKnown sorts the placed and sums the rest", () => {
    const r = splitKnown([{ k: "a", n: 1 }, { k: null, n: 5 }, { k: "b", n: 3 }], (x) => x.k);
    expect(r.known.map((x) => x.k)).toEqual(["b", "a"]);
    expect(r.unknown).toBe(5);
  });

  it("names a place: a state alone, a region with its country, a city only with a region", () => {
    expect(placeLabel({ country: "US", name: "United States", region: "Nevada" })).toBe("Nevada");
    expect(placeLabel({ country: "US", name: "United States", region: null })).toBe("United States");
    expect(placeLabel({ country: "CA", name: "Canada", region: "Ontario" })).toBe("Ontario, Canada");
    expect(placeLabel({ country: "GB", name: "United Kingdom", region: null })).toBe("United Kingdom");
    expect(placeLabel({ country: "US", name: "United States", region: "Nevada", city: "Pahrump" })).toBe("Pahrump, Nevada");
    expect(placeLabel({ country: "US", name: "United States", region: null, city: "Pahrump" })).toBe("United States");
    expect(placeLabel({ country: null, region: null })).toBeNull();
  });

  it("dates and ages", () => {
    expect(dayLabel("2026-09-27")).toBe("27 Sep 2026");
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(agoLabel("2026-10-19T11:59:30Z", now)).toBe("just now");
    expect(agoLabel("2026-10-19T11:56:00Z", now)).toBe("4 min ago");
    expect(agoLabel("2026-10-19T09:00:00Z", now)).toBe("3 h ago");
    expect(agoLabel("2026-10-16T12:00:00Z", now)).toBe("3 d ago");
  });
});

/** A period with `placed` listeners in the US and the rest in the unknown bucket. */
const period = (placed: number, total: number) => ({
  total,
  countries: [
    ...(placed ? [{ country: "US", n: placed }] : []),
    ...(total > placed ? [{ country: null, n: total - placed }] : []),
  ],
});

describe("how much of a period is placed", () => {
  it("placed is the total less the unknown-country bucket", () => {
    expect(placedCount(period(1, 1206))).toBe(1);
    expect(placedCount({ total: 9, countries: [{ country: "US", n: 4 }, { country: "CA", n: 3 }, { country: null, n: 2 }] })).toBe(7);
  });

  it("says so while under 90% is placed, in the period's own numbers", () => {
    expect(placedNote(period(1, 1206))).toBe("1 of 1,206 placed so far. The map fills in as listeners come back.");
    expect(placedNote(period(89, 100))).toBe("89 of 100 placed so far. The map fills in as listeners come back.");
  });

  it("goes quiet at 90% placed, and for an empty period", () => {
    expect(placedNote(period(90, 100))).toBeNull();
    expect(placedNote(period(100, 100))).toBeNull();
    expect(placedNote(period(0, 0))).toBeNull();
  });
});

describe("defaultPeriod", () => {
  it("opens on All time once a quarter of it is placed", () => {
    expect(defaultPeriod({ allTime: period(25, 100), week: period(0, 10) })).toBe("allTime");
  });

  it("else on This week once a quarter of that is placed", () => {
    expect(defaultPeriod({ allTime: period(24, 100), week: period(3, 12) })).toBe("week");
    // Today's numbers: 1 of 1,206 all time, most of this week's 212 not yet placed either.
    expect(defaultPeriod({ allTime: period(1, 1206), week: period(52, 212) })).toBe("now");
  });

  it("else on Right now, also before anyone is counted", () => {
    expect(defaultPeriod({ allTime: period(1, 1206), week: period(2, 212) })).toBe("now");
    expect(defaultPeriod({ allTime: period(0, 0), week: period(0, 0) })).toBe("now");
  });
});
