// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  STATION_ID_SEC,
  REPEAT_WINDOW_DAYS,
  addDays,
  applyOutageSwap,
  buildDay,
  buildDays,
  locate,
  pacificDay,
  pacificDayBounds,
  type BuildInputs,
  type CatalogRow,
  type DayProgram,
} from "../schedule";
import { communityKey } from "@/lib/utils/community-key";
import { REMOVED_FROM_CATALOG } from "@/lib/library/removed-episodes";

/**
 * The station's program. Everything here runs the real `buildDay` against
 * either the real shipped catalog or a small hand-built one whose answer can be
 * worked out on paper.
 */

const CATALOG: CatalogRow[] = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../public/seed/library.json"), "utf8"),
);

const H = 3600;
function row(name: string, airDate: string, duration: number | null = 2 * H): CatalogRow {
  return {
    fileHash: `archive:coll:${name}.mp3`,
    fileName: `${name}.mp3`,
    archiveIdentifier: "coll",
    title: name,
    airDate,
    duration,
    sourceUrl: `https://archive.org/download/coll/${name}.mp3`,
  };
}
function plays(entries: [CatalogRow, number][]): Map<string, number> {
  return new Map(entries.map(([r, n]) => [communityKey(r)!, n]));
}
const hashes = (p: DayProgram) => p.slots.map((s) => s.fileHash);

describe("Pacific station day", () => {
  it("runs midnight to midnight Pacific: 24 h on an ordinary day", () => {
    const { start, end } = pacificDayBounds("2026-09-25");
    // PDT is UTC−7.
    expect(new Date(start).toISOString()).toBe("2026-09-25T07:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-09-26T07:00:00.000Z");
    expect(pacificDay(start)).toBe("2026-09-25");
    expect(pacificDay(end - 1)).toBe("2026-09-25");
    expect(pacificDay(end)).toBe("2026-09-26");
  });

  it("is 23 h on the spring-forward date and 25 h on the fall-back date", () => {
    const spring = pacificDayBounds("2026-03-08");
    expect(new Date(spring.start).toISOString()).toBe("2026-03-08T08:00:00.000Z"); // PST
    expect(new Date(spring.end).toISOString()).toBe("2026-03-09T07:00:00.000Z"); // PDT
    expect(spring.end - spring.start).toBe(23 * H * 1000);

    const fall = pacificDayBounds("2026-11-01");
    expect(new Date(fall.start).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(new Date(fall.end).toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(fall.end - fall.start).toBe(25 * H * 1000);
  });

  it("fills a DST day to its own length and starts the next day at its midnight", () => {
    const inputs: BuildInputs = { catalog: CATALOG, plays: new Map() };
    for (const day of ["2026-03-08", "2026-11-01"]) {
      const p = buildDay(day, inputs, []);
      const { start, end } = pacificDayBounds(day);
      expect(p.slots[0].start).toBe(start);
      const last = p.slots[p.slots.length - 1];
      expect(last.start).toBeLessThan(end);
      // Filled: nothing more could start before midnight.
      expect(last.start + last.duration * 1000 + STATION_ID_SEC * 1000).toBeGreaterThanOrEqual(end);
      expect(last.end).toBeLessThanOrEqual(end);
      const next = buildDay(addDays(day, 1), inputs, [p]);
      expect(next.slots[0].start).toBe(end);
    }
  });
});

describe("the program is a function of the date", () => {
  const inputs: BuildInputs = { catalog: CATALOG, plays: new Map() };

  it("the same date gives the same program, every time", () => {
    const a = buildDay("2026-09-25", inputs, []);
    const b = buildDay("2026-09-25", { catalog: [...CATALOG].reverse(), plays: new Map() }, []);
    // Catalog order is not an input: every sort has a total tie-break.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.slots.length).toBeGreaterThan(3);
  });

  it("a frozen day stays frozen when community plays change", () => {
    const day = "2026-09-25";
    const frozen = new Map([[day, buildDay(day, inputs, [])]]);
    // Plays swing hard enough to reorder every fan favorite.
    const swung = new Map(CATALOG.map((r, i) => [communityKey(r)!, i * 7]));
    const built = buildDays(day, { catalog: CATALOG, plays: swung }, frozen);
    expect(built.map((d) => d.day)).not.toContain(day);
    // And the recompute *would* differ — so the freeze is what held it.
    expect(JSON.stringify(buildDay(day, { catalog: CATALOG, plays: swung }, []))).not.toBe(
      JSON.stringify(frozen.get(day)),
    );
  });

  it("builds the missing days of the repeat window, oldest first, deterministically", () => {
    const a = buildDays("2026-09-25", inputs, new Map());
    const b = buildDays("2026-09-25", inputs, new Map());
    expect(a.map((d) => d.day)).toEqual(
      Array.from({ length: REPEAT_WINDOW_DAYS + 1 }, (_, i) => addDays("2026-09-11", i)),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("on this date", () => {
  it("every episode aired on today's month and day, any year, oldest first, before any favorite", () => {
    // Names sort the other way from air dates, so file-hash order (the
    // tie-break) cannot pass for date order.
    const catalog = [
      row("b-1998", "1998-09-25"),
      row("fav", "1995-01-01"),
      row("zz-1993", "1993-09-25"),
      row("a-1998", "1998-09-25"),
      row("not-today", "1996-09-24"),
    ];
    const p = buildDay("2026-09-25", { catalog, plays: plays([[catalog[1], 99]]) }, []);
    // Oldest first; the two 1998 broadcasts tie on date and fall back to hash.
    expect(p.slots.slice(0, 3).map((s) => s.title)).toEqual(["zz-1993", "a-1998", "b-1998"]);
    expect(p.slots.slice(0, 3).every((s) => s.kind === "on-this-date")).toBe(true);
    expect(p.slots[3].kind).toBe("fan-favorite");
    expect(p.slots[3].title).toBe("fav");
  });

  it("uses the real catalog's broadcasts for the date", () => {
    const p = buildDay("2026-09-25", { catalog: CATALOG, plays: new Map() }, []);
    const expected = CATALOG.filter(
      (r) => r.airDate?.slice(5) === "09-25" && (r.duration ?? 0) > 0 && !REMOVED_FROM_CATALOG.has(r.fileHash),
    )
      .map((r) => r.airDate!)
      .sort();
    const got = p.slots.filter((s) => s.kind === "on-this-date").map((s) => s.airDate);
    expect(got).toEqual(expected);
    expect(got.length).toBeGreaterThan(0);
  });

  it("puts 29 February broadcasts on 28 February in a non-leap year", () => {
    const catalog = [row("leap", "1996-02-29"), row("other", "1994-05-05")];
    const p = buildDay("2027-02-28", { catalog, plays: new Map() }, []);
    expect(p.slots[0].title).toBe("leap");
    expect(p.slots[0].kind).toBe("on-this-date");
  });

  it("skips episodes with no duration, and the pulled ones", () => {
    const catalog = [row("nodur", "1993-09-25", null), row("zero", "1994-09-25", 0), row("ok", "1995-09-25")];
    const p = buildDay("2026-09-25", { catalog, plays: new Map() }, []);
    expect(hashes(p)).not.toContain(catalog[0].fileHash);
    expect(hashes(p)).not.toContain(catalog[1].fileHash);
    // The pulled episode is no longer in the shipped catalog, so inject it.
    const [removedHash] = [...REMOVED_FROM_CATALOG.keys()];
    const withPulled = [{ ...row("pulled", "2002-03-19"), fileHash: removedHash }, row("x", "1999-01-01")];
    expect(hashes(buildDay("2026-03-19", { catalog: withPulled, plays: new Map() }, []))).not.toContain(removedHash);
  });
});

describe("fan favorites and the 14-day repeat rule", () => {
  // Thirty two-hour shows, none on any date near the test days.
  const catalog = Array.from({ length: 30 }, (_, i) => row(`show-${String(i).padStart(2, "0")}`, "1990-01-01"));
  const inputs: BuildInputs = {
    catalog,
    plays: plays(catalog.map((r, i) => [r, 1000 - i] as [CatalogRow, number])),
  };

  it("orders favorites by community plays", () => {
    const p = buildDay("2026-06-10", inputs, []);
    expect(p.slots.slice(0, 3).map((s) => s.title)).toEqual(["show-00", "show-01", "show-02"]);
  });

  it("skips a favorite that aired in the last 14 days, and allows it again after", () => {
    const earlier = buildDay("2026-06-01", inputs, []);
    const aired = new Set(hashes(earlier));
    expect(aired.size).toBeGreaterThan(5);

    // 14 days later is still inside the window.
    const within = buildDay(addDays("2026-06-01", REPEAT_WINDOW_DAYS), inputs, [earlier]);
    expect(hashes(within).filter((h) => aired.has(h))).toEqual([]);

    // 15 days later it is not: the most-played show is back at the top.
    const after = buildDay(addDays("2026-06-01", REPEAT_WINDOW_DAYS + 1), inputs, [earlier]);
    expect(after.slots[0].fileHash).toBe(earlier.slots[0].fileHash);
  });

  it("does not skip an on-this-date broadcast because it aired as a favorite", () => {
    const special = row("anniv", "1997-06-15");
    const cat = [special, ...catalog];
    const inp: BuildInputs = { catalog: cat, plays: plays([[special, 5000]]) };
    const before = buildDay("2026-06-10", inp, []);
    expect(before.slots[0].fileHash).toBe(special.fileHash);
    const onItsDate = buildDay("2026-06-15", inp, [before]);
    expect(onItsDate.slots[0]).toMatchObject({ fileHash: special.fileHash, kind: "on-this-date" });
  });
});

describe("the timeline", () => {
  it("lays slots end to end with a station ID gap between each", () => {
    const p = buildDay("2026-09-25", { catalog: CATALOG, plays: new Map() }, []);
    for (let i = 1; i < p.slots.length; i++) {
      const prev = p.slots[i - 1];
      expect(p.slots[i].start - (prev.start + Math.round(prev.duration * 1000))).toBe(STATION_ID_SEC * 1000);
      expect(prev.end).toBe(prev.start + Math.round(prev.duration * 1000));
    }
  });

  it("cuts the last slot at midnight", () => {
    const catalog = [row("long", "1990-01-01", 10 * H), row("long2", "1990-01-02", 10 * H), row("long3", "1990-01-03", 10 * H)];
    const p = buildDay("2026-09-25", { catalog, plays: new Map() }, []);
    expect(p.slots).toHaveLength(3);
    expect(p.slots[2].end).toBe(p.end);
    expect(p.slots[2].duration).toBe(10 * H);
  });

  it("locates the show, the offset into it, and the station ID between shows", () => {
    const p = buildDay("2026-09-25", { catalog: CATALOG, plays: new Map() }, []);
    const [a, b] = p.slots;
    const mid = a.start + 90_000;
    expect(locate(p.slots, mid, p.end)).toEqual({ slot: a, startedAt: a.start, offsetSec: 90, endsAt: a.end });
    expect(locate(p.slots, a.end + 1000, p.end)).toEqual({ stationId: true, endsAt: b.start });
    expect(locate(p.slots, b.start, p.end)).toMatchObject({ slot: b, offsetSec: 0 });
  });
});

describe("outage swap", () => {
  const catalog = Array.from({ length: 40 }, (_, i) => row(`s${String(i).padStart(2, "0")}`, "1990-01-01", (2 + (i % 3)) * H));
  const inputs: BuildInputs = { catalog, plays: plays(catalog.map((r, i) => [r, 100 - i] as [CatalogRow, number])) };
  const byHash = new Map(catalog.map((r) => [r.fileHash, r]));
  const program = buildDay("2026-06-10", inputs, []);
  const scheduled = hashes(program);
  const unscheduled = catalog.map((r) => r.fileHash).filter((h) => !scheduled.includes(h));
  // The mirror holds slots 0 and 2 of today, and every show not on today.
  const manifest = {
    version: "v1",
    fileHashes: new Set([scheduled[0], scheduled[2], ...unscheduled]),
  };

  it("swaps only the slots the mirror cannot play, keeping every slot time", () => {
    const swapped = applyOutageSwap(program, manifest, byHash);
    expect(swapped.slots).toHaveLength(program.slots.length);
    swapped.slots.forEach((s, i) => {
      const orig = program.slots[i];
      expect(s.start).toBe(orig.start);
      expect(s.end).toBeLessThanOrEqual(orig.end);
      if (manifest.fileHashes.has(orig.fileHash)) {
        expect(s).toBe(orig);
      } else {
        expect(s.kind).toBe("outage-swap");
        expect(s.replaces).toBe(orig.fileHash);
        expect(manifest.fileHashes.has(s.fileHash)).toBe(true);
      }
    });
    // Nothing airs twice, and nothing the mirror is already playing today is reused.
    const all = hashes(swapped);
    expect(new Set(all).size).toBe(all.length);
  });

  it("is deterministic: same day, same manifest, same swap", () => {
    const a = applyOutageSwap(program, manifest, byHash);
    const b = applyOutageSwap(program, { version: "v1", fileHashes: new Set([...manifest.fileHashes].reverse()) }, byHash);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("prefers a substitute long enough for the slot, most-played first, and cuts it at the slot end", () => {
    const swapped = applyOutageSwap(program, manifest, byHash);
    const i = swapped.slots.findIndex((s) => s.kind === "outage-swap");
    const orig = program.slots[i];
    const len = orig.end - orig.start;
    const eligible = program.ranking.filter(
      (h) => manifest.fileHashes.has(h) && !scheduled.slice(0, i).includes(h) && (byHash.get(h)!.duration! * 1000 >= len),
    );
    expect(swapped.slots[i].fileHash).toBe(eligible.filter((h) => h !== scheduled[0] && h !== scheduled[2])[0]);
    expect(swapped.slots[i].end).toBe(orig.end);
  });

  it("leaves a fully mirrored day alone", () => {
    const all = { version: "v2", fileHashes: new Set(catalog.map((r) => r.fileHash)) };
    expect(applyOutageSwap(program, all, byHash)).toBe(program);
  });
});

describe("splitShowTitle", () => {
  it("splits at the first ' - ' only; a title without one is all episode", async () => {
    const { splitShowTitle } = await import("@/lib/live/format");
    expect(splitShowTitle("Coast to Coast AM - Area 51 - Part 2")).toEqual({
      show: "Coast to Coast AM",
      episode: "Area 51 - Part 2",
    });
    expect(splitShowTitle("Dreamland")).toEqual({ show: null, episode: "Dreamland" });
    expect(splitShowTitle(" - leading")).toEqual({ show: null, episode: " - leading" });
    expect(splitShowTitle("trailing - ")).toEqual({ show: null, episode: "trailing - " });
  });
});
