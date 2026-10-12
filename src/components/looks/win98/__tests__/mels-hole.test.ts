import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  depthStatus,
  FEET_PER_PRESS,
  FEET_PER_SECOND,
  formatFeet,
  formatMiles,
  isMelsHoleShow,
  lineOut,
  MEL_LINE_FEET,
  MELS_HOLE_LORE,
} from "../mels-hole";

describe("the counter", () => {
  it("pays out line with time and with presses", () => {
    expect(lineOut(0)).toBe(0);
    expect(lineOut(1000)).toBe(FEET_PER_SECOND);
    expect(lineOut(0, 3 * FEET_PER_PRESS)).toBe(3000);
    expect(lineOut(-50)).toBe(0);
  });

  it("formats feet and miles", () => {
    expect(formatFeet(80000)).toBe("80,000 ft");
    expect(formatMiles(MEL_LINE_FEET)).toBe("15.2 miles");
  });

  it("never reports a bottom, however deep", () => {
    for (const feet of [0, 1, 79_999, 80_000, 80_001, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      const s = depthStatus(feet);
      expect(s).toMatch(/not reached/);
      expect(s.toLowerCase()).not.toMatch(/bottom (reached|found)|hit bottom/);
    }
    expect(depthStatus(MEL_LINE_FEET)).toContain("Past the caller's 80,000 feet");
    expect(depthStatus(MEL_LINE_FEET - 1)).toBe("Bottom: not reached");
  });
});

describe("the lore", () => {
  const text = MELS_HOLE_LORE.join(" ");

  it("tells it as the caller's claim, not as fact", () => {
    expect(text).toMatch(/claimed/);
    expect(text).toMatch(/gave his name as Mel Waters/);
    expect(text).toMatch(/No one has ever confirmed/);
    expect(text).toMatch(/February 1997/);
    expect(text).toMatch(/Ellensburg, Washington/);
    expect(text).toMatch(/80,000 feet/);
  });

  it("uses no em dash", () => {
    expect(text).not.toContain("—");
  });
});

describe("isMelsHoleShow", () => {
  it("matches by tag or title, and not otherwise", () => {
    expect(isMelsHoleShow({ aiTags: ["Mels Hole"] })).toBe(true);
    expect(isMelsHoleShow({ title: "Mel's Hole Update" })).toBe(true);
    expect(isMelsHoleShow({ title: "Calls from Mel Waters" })).toBe(true);
    expect(isMelsHoleShow({ title: "Area 51", aiTags: ["ufo"] })).toBe(false);
  });

  it("finds the shows in the real catalog, the first dated February 1997", () => {
    const catalog = JSON.parse(readFileSync(join(process.cwd(), "public/seed/library.json"), "utf8")) as Array<{
      title?: string;
      fileName?: string;
      aiTags?: string[];
      airDate?: string;
    }>;
    const shows = catalog.filter(isMelsHoleShow);
    expect(shows.length).toBeGreaterThanOrEqual(5);
    const first = shows.map((s) => s.airDate ?? "").filter(Boolean).sort()[0];
    expect(first.startsWith("1997-02")).toBe(true);
  });
});
