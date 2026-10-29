// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SEASON_SCRIPT, readSeason, seasonOfDay, seasonOn, showSeason, thanksgivingDay } from "../season";

/**
 * The holiday seasons. Thanksgiving moves, so the windows are checked on the
 * calendar of several years, and the page head's script, which inlines
 * `seasonOn`, is run for real and held to the same answers.
 */

const on = (iso: string) => seasonOfDay(iso);

describe("seasonOn", () => {
  it("Thanksgiving is the fourth Thursday of November", () => {
    expect([2024, 2025, 2026, 2027, 2028, 2029, 2030].map(thanksgivingDay)).toEqual([28, 27, 26, 25, 23, 22, 28]);
    for (let y = 1990; y <= 2100; y++) {
      const d = new Date(Date.UTC(y, 10, thanksgivingDay(y)));
      expect(d.getUTCDay(), String(y)).toBe(4);
      expect(thanksgivingDay(y), String(y)).toBeGreaterThan(21);
    }
  });

  it("Halloween: 15 October to 1 November", () => {
    expect(on("2026-10-14")).toBeNull();
    expect(on("2026-10-15")).toBe("halloween");
    expect(on("2026-10-31")).toBe("halloween");
    expect(on("2026-11-01")).toBe("halloween");
    expect(on("2026-11-02")).toBeNull();
  });

  it("Thanksgiving: the 10 days before it and the day itself", () => {
    // 2026: Thursday 26 November.
    expect(on("2026-11-15")).toBeNull();
    expect(on("2026-11-16")).toBe("thanksgiving");
    expect(on("2026-11-26")).toBe("thanksgiving");
    // 2028: Thursday 23 November.
    expect(on("2028-11-12")).toBeNull();
    expect(on("2028-11-13")).toBe("thanksgiving");
    expect(on("2028-11-23")).toBe("thanksgiving");
  });

  it("Christmas and winter: the day after Thanksgiving to 6 January", () => {
    expect(on("2026-11-27")).toBe("winter");
    expect(on("2026-12-25")).toBe("winter");
    expect(on("2026-12-31")).toBe("winter");
    expect(on("2027-01-06")).toBe("winter");
    expect(on("2027-01-07")).toBeNull();
    expect(on("2028-11-24")).toBe("winter");
  });

  it("every day of a year is in at most one season, and the seasons run unbroken", () => {
    const count: Record<string, number> = {};
    for (let d = Date.UTC(2026, 0, 1); d < Date.UTC(2027, 0, 1); d += 86_400_000) {
      const s = on(new Date(d).toISOString().slice(0, 10)) ?? "none";
      count[s] = (count[s] ?? 0) + 1;
    }
    // 18 days of Halloween, 11 of Thanksgiving, 35 of winter to New Year's Eve plus 6 in January.
    expect(count).toMatchObject({ halloween: 18, thanksgiving: 11, winter: 35 + 6 });
  });
});

describe("showSeason", () => {
  it("names the holiday shows, and only them", () => {
    expect(showSeason("Special - Ghost to Ghost 2007")).toBe("halloween");
    expect(showSeason("Coast to Coast AM - Open Lines Christmas Eve with Ramona")).toBe("winter");
    expect(showSeason("Special - New Year's Predictions Special")).toBe("winter");
    expect(showSeason("Special - Millennium New Year's Special")).toBe("winter");
    expect(showSeason("A Thanksgiving Open Lines")).toBe("thanksgiving");
    expect(showSeason("Coast to Coast AM - Prophecy and Predictions")).toBeNull();
    expect(showSeason("Coast to Coast AM - Ghosts and Hauntings")).toBeNull();
    expect(showSeason(null)).toBeNull();
  });

  it("the real catalog: every Ghost to Ghost is Halloween's", () => {
    const catalog = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../public/seed/library.json"), "utf8")) as { title?: string }[];
    const g2g = catalog.filter((r) => /ghost to ghost/i.test(r.title ?? ""));
    expect(g2g.length).toBeGreaterThan(15);
    for (const r of g2g) expect(showSeason(r.title), r.title).toBe("halloween");
  });
});

describe("SEASON_SCRIPT, as the page head runs it", () => {
  const run = (date: Date, search = "") => {
    document.documentElement.removeAttribute("data-season");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(date);
    window.history.replaceState(null, "", `/library${search}`);
    new Function(SEASON_SCRIPT)();
    vi.useRealTimers();
    return document.documentElement.getAttribute("data-season");
  };
  afterEach(() => {
    document.documentElement.removeAttribute("data-season");
    window.history.replaceState(null, "", "/");
  });

  it("dresses the page for the visitor's own date, agreeing with seasonOn every day of two years", () => {
    for (let d = new Date(2026, 0, 1); d < new Date(2028, 0, 1); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const want = seasonOn(d.getFullYear(), d.getMonth() + 1, d.getDate());
      expect(run(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21, 30)), d.toDateString()).toBe(want);
    }
  });

  it("?season= previews one, ?season=off none, and anything else is ignored", () => {
    const july = new Date(2026, 6, 4, 12);
    expect(run(july, "?season=winter")).toBe("winter");
    expect(run(new Date(2026, 9, 30, 12), "?season=off")).toBeNull();
    expect(run(july, "?season=easter")).toBeNull();
    expect(run(new Date(2026, 9, 30, 12), "?q=x&season=thanksgiving")).toBe("thanksgiving");
  });

  it("readSeason reads what it set, and nothing else", () => {
    expect(run(new Date(2026, 9, 30, 12))).toBe("halloween");
    expect(readSeason()).toBe("halloween");
    document.documentElement.setAttribute("data-season", "easter");
    expect(readSeason()).toBeNull();
  });

  it("the root layout runs it in the head", () => {
    const layout = readFileSync(path.resolve(import.meta.dirname, "../../../app/[look]/layout.tsx"), "utf8");
    expect(layout).toMatch(/<head>[\s\S]*__html: SEASON_SCRIPT[\s\S]*<\/head>/);
  });
});

describe("seasons.css", () => {
  const css = readFileSync(path.resolve(import.meta.dirname, "../../../styles/seasons.css"), "utf8");
  const block = (look: string, season: string) => {
    const m = new RegExp(`html\\[data-look="${look}"\\]\\[data-season="${season}"\\]\\s*\\{([^}]*)\\}`).exec(css);
    return m?.[1] ?? "";
  };
  it("each season re-colours both looks: Win98's title bars and desktop, Night's accent", () => {
    for (const season of ["halloween", "thanksgiving", "winter"]) {
      expect(block("win98", season), season).toMatch(/--hd-w98-title-start:[\s\S]*--hd-w98-title-end:[\s\S]*--hd-w98-teal:/);
      expect(block("night", season), season).toMatch(/--hd-amber: var\(--hd-[a-z-]+\);/);
    }
  });
  it("every Win98 title bar sweeps from the season's start, not a fixed navy", () => {
    const w98 = readFileSync(path.resolve(import.meta.dirname, "../../../styles/look-win98.css"), "utf8");
    expect(w98).not.toMatch(/var\(--hd-navy\) 0%, var\(--hd-w98-title-end\)/);
    expect(w98.match(/var\(--hd-w98-title-start\) 0%, var\(--hd-w98-title-end\) 100%/g)?.length).toBeGreaterThanOrEqual(7);
  });
  it("is imported after the looks, so it wins", () => {
    const globals = readFileSync(path.resolve(import.meta.dirname, "../../../app/globals.css"), "utf8");
    expect(globals.indexOf('@import "../styles/seasons.css"')).toBeGreaterThan(globals.indexOf('@import "../styles/look-win98.css"'));
  });
});
