// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  STATION_ID_SEC,
  REPEAT_WINDOW_DAYS,
  GUEST_GAP_DAYS,
  guestsOf,
  isAirable,
  addDays,
  applyOutageSwap,
  buildDay,
  buildDays,
  locate,
  pacificDay,
  pacificDayBounds,
  requestStartAt,
  requestCloseAt,
  requestDayAt,
  applyRequest,
  applyHostSwap,
  isProgrammable,
  packer,
  requestHourOf,
  requestHourLabel,
  pacificHourLabel,
  NOT_ART_HOSTED,
  MIN_PROGRAM_SEC,
  TIGHT_MS,
  type BuildInputs,
  type RequestNight,
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
      // Filled to midnight, and the last show plays to its end inside the day.
      expect(last.end + STATION_ID_SEC * 1000).toBeLessThanOrEqual(end);
      expect(end - (last.end + STATION_ID_SEC * 1000)).toBeLessThanOrEqual(TIGHT_MS);
      for (const s of p.slots) expect(s.end).toBe(s.start + Math.round(s.duration * 1000));
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
      Array.from({ length: REPEAT_WINDOW_DAYS + 1 }, (_, i) => addDays("2026-09-25", i - REPEAT_WINDOW_DAYS)),
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
    const expected = CATALOG.filter((r) => r.airDate?.slice(5) === "09-25" && isProgrammable(r))
      .map((r) => r.airDate!)
      .sort();
    // Oldest first, save that one that does not pack before the request hour
    // gives way to the next that does. Every one airs that fits the day.
    const got = p.slots.filter((s) => s.kind === "on-this-date").map((s) => s.airDate);
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeGreaterThanOrEqual(expected.length - 2);
    expect(expected).toEqual(expect.arrayContaining(got));
    expect(new Set(got).size).toBe(got.length);
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

describe("fan favorites and the repeat rule", () => {
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

  it("skips a favorite that aired in the last 30 days, and allows it again after", () => {
    const earlier = buildDay("2026-06-01", inputs, []);
    const aired = new Set(hashes(earlier));
    expect(aired.size).toBeGreaterThan(5);

    // 30 days later is still inside the window.
    const within = buildDay(addDays("2026-06-01", REPEAT_WINDOW_DAYS), inputs, [earlier]);
    expect(hashes(within).filter((h) => aired.has(h))).toEqual([]);

    // 31 days later it is not: the most-played show is back at the top.
    const after = buildDay(addDays("2026-06-01", REPEAT_WINDOW_DAYS + 1), inputs, [earlier]);
    expect(after.slots[0].fileHash).toBe(earlier.slots[0].fileHash);
  });

  it("does not skip an on-this-date broadcast because it aired as a favorite", () => {
    const special = row("anniv", "1997-06-15");
    const cat = [special, ...catalog];
    const inp: BuildInputs = { catalog: cat, plays: plays([[special, 5000]]) };
    // Its own date is 36 days off, outside the hold: a favorite, on top.
    const before = buildDay("2026-05-10", inp, []);
    expect(before.slots[0]).toMatchObject({ fileHash: special.fileHash, kind: "fan-favorite" });
    // As if it had aired as a favorite five days before its date.
    const aired: DayProgram = { ...before, day: "2026-06-10" };
    const onItsDate = buildDay("2026-06-15", inp, [aired]);
    expect(onItsDate.slots[0]).toMatchObject({ fileHash: special.fileHash, kind: "on-this-date" });
  });

  it("holds a favorite for its own date when that comes up in the window (back-to-back days, 2026-10-28)", () => {
    const special = row("anniv", "1997-06-15");
    const inp: BuildInputs = { catalog: [special, ...catalog], plays: plays([[special, 5000]]) };
    // The day before its date, and 30 days before: held, though it is the most played.
    for (const day of ["2026-06-14", addDays("2026-06-15", -REPEAT_WINDOW_DAYS)]) {
      expect(hashes(buildDay(day, inp, [])), day).not.toContain(special.fileHash);
    }
    // Control: 31 days before, outside the hold, it is the first favorite.
    expect(buildDay(addDays("2026-06-15", -REPEAT_WINDOW_DAYS - 1), inp, []).slots[0].fileHash).toBe(special.fileHash);
  });

  it("the real catalog: 28 October's broadcast is not 27 October's favorite", () => {
    const md = "10-28";
    const own = CATALOG.filter(isAirable).filter((r) => r.airDate?.slice(5, 10) === md);
    expect(own.length).toBeGreaterThan(0);
    // Make every one of them the most played show there is.
    const inp: BuildInputs = { catalog: CATALOG, plays: plays(own.map((r) => [r, 1_000_000] as [CatalogRow, number])) };
    const favs = buildDay("2026-10-27", inp, []).slots.filter((s) => s.kind === "fan-favorite").map((s) => s.fileHash);
    expect(favs.length).toBeGreaterThan(0);
    for (const r of own) expect(favs).not.toContain(r.fileHash);
  });

  it("a favorite whose guest was on yesterday or today waits behind one whose guest was not", () => {
    const g = (name: string, guest: string) => ({ ...row(name, "1990-01-01"), guestName: guest });
    const a1 = g("hoagland-1", "Richard C. Hoagland");
    const a2 = g("hoagland-2", "Richard C. Hoagland & Seth Shostak");
    const b = g("dames-1", "Major Ed Dames");
    const cat = [a1, a2, b, ...catalog];
    const inp: BuildInputs = { catalog: cat, plays: plays([[a1, 9000], [a2, 8000], [b, 10]]) };
    const day = buildDay("2026-06-10", inp, []);
    // Hoagland, then not Hoagland again until nothing else is left.
    expect(hashes(day).slice(0, 2)).toEqual([a1.fileHash, b.fileHash]);
    expect(hashes(day)).not.toContain(a2.fileHash);
    // Yesterday's guest waits today too; the day after, he is back on top.
    const yesterday: DayProgram = { ...day, day: "2026-06-11", slots: day.slots.filter((s) => s.fileHash === a1.fileHash) };
    const next = buildDay("2026-06-12", inp, [yesterday]);
    expect(next.slots[0].fileHash).not.toBe(a2.fileHash);
    expect(hashes(next)).toContain(b.fileHash);
    const later = buildDay(addDays("2026-06-11", GUEST_GAP_DAYS + 1), inp, [yesterday]);
    expect(later.slots[0].fileHash).toBe(a2.fileHash);
  });

  it("a holiday show is a favorite only in its own season", () => {
    // Dated 2 December, so on 3 December it is not held for its date (24 December would be).
    const xmas = row("Christmas Open Lines", "1998-12-02");
    const g2g = row("Ghost to Ghost 1999", "1999-06-10");
    // Dated in July, so none of them is held for its date in any of these months.
    const rest = catalog.map((r) => ({ ...r, airDate: "1990-07-01" }));
    const inp: BuildInputs = { catalog: [xmas, g2g, ...rest], plays: plays([[xmas, 9000], [g2g, 8000]]) };
    const october = hashes(buildDay("2026-10-20", inp, []));
    expect(october).not.toContain(xmas.fileHash);
    expect(october[0]).toBe(g2g.fileHash);
    const december = hashes(buildDay("2026-12-03", inp, []));
    expect(december[0]).toBe(xmas.fileHash);
    expect(december).not.toContain(g2g.fileHash);
    // Out of every season, neither.
    const march = hashes(buildDay("2026-03-03", inp, []));
    expect(march).not.toContain(xmas.fileHash);
    expect(march).not.toContain(g2g.fileHash);
  });
});

describe("guestsOf", () => {
  it("splits a guest field into people, lower case", () => {
    expect(guestsOf("Richard C. Hoagland & Seth Shostak")).toEqual(["richard c. hoagland", "seth shostak"]);
    expect(guestsOf("Brendan Cook, Barbara McBeath")).toEqual(["brendan cook", "barbara mcbeath"]);
    expect(guestsOf("Michael Sebastian and Nicole Sebastian")).toEqual(["michael sebastian", "nicole sebastian"]);
    expect(guestsOf(null)).toEqual([]);
    expect(guestsOf("")).toEqual([]);
  });
});

describe("the timeline", () => {
  it("lays slots end to end with a station ID gap between each, except into the request hour", () => {
    const p = buildDay("2026-09-25", { catalog: CATALOG, plays: new Map() }, []);
    const ten = requestStartAt("2026-09-25");
    for (let i = 1; i < p.slots.length; i++) {
      const prev = p.slots[i - 1];
      if (p.slots[i].start === ten) {
        // The last show before the request hour ends, with its station ID,
        // by then, and close to it.
        expect(prev.end + STATION_ID_SEC * 1000).toBeLessThanOrEqual(ten);
        expect(ten - (prev.end + STATION_ID_SEC * 1000)).toBeLessThanOrEqual(TIGHT_MS);
        continue;
      }
      expect(prev.end).toBe(prev.start + Math.round(prev.duration * 1000));
      expect(p.slots[i].start - (prev.start + Math.round(prev.duration * 1000))).toBe(STATION_ID_SEC * 1000);
    }
  });

  it("never cuts a show: what fits nowhere is left out, and the station ID holds the time (2026-11-12)", () => {
    // Before, the third ten-hour show was cut at 10 PM and a fourth at midnight.
    const catalog = [row("long", "1990-01-01", 10 * H), row("long2", "1990-01-02", 10 * H), row("long3", "1990-01-03", 10 * H)];
    const p = buildDay("2026-09-25", { catalog, plays: new Map() }, []);
    expect(p.slots.map((s) => s.title)).toEqual(["long", "long2"]);
    for (const s of p.slots) expect(s.end - s.start).toBe(10 * H * 1000);
  });

  it("packs the real catalog: every show plays in full, the day ends within TIGHT_MS of midnight, before the hour too", () => {
    let history: DayProgram[] = [];
    for (let i = 0; i < 20; i++) {
      const day = addDays("2026-11-10", i);
      const p = buildDay(day, { catalog: CATALOG, plays: new Map() }, history);
      history = [p, ...history];
      const hour = requestStartAt(day);
      for (const s of p.slots) {
        expect(s.end).toBe(s.start + Math.round(s.duration * 1000));
        expect(s.end + STATION_ID_SEC * 1000).toBeLessThanOrEqual(s.start < hour ? hour : p.end);
      }
      const before = p.slots.filter((s) => s.start < hour);
      const last = before[before.length - 1];
      expect(hour - (last.end + STATION_ID_SEC * 1000)).toBeLessThanOrEqual(TIGHT_MS);
      const end = p.slots[p.slots.length - 1];
      expect(p.end - (end.end + STATION_ID_SEC * 1000)).toBeLessThanOrEqual(TIGHT_MS);
    }
  });

  it("programs no fragment: every slot is at least MIN_PROGRAM_SEC long", () => {
    const p = buildDay("2026-11-20", { catalog: CATALOG, plays: new Map() }, []);
    for (const s of p.slots) expect(s.duration).toBeGreaterThanOrEqual(MIN_PROGRAM_SEC);
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

describe("the Request Line's slot (2026-10-14; 8 PM from 2026-11-14)", () => {
  const inputs: BuildInputs = { catalog: CATALOG, plays: new Map() };
  const byHash = new Map(CATALOG.map((r) => [r.fileHash, r]));
  const DAYS = ["2026-09-25", "2026-10-14", "2026-03-08", "2026-11-01", "2027-02-28", "2026-12-31", "2026-11-14", "2027-03-14"];

  it("10 PM until 2026-11-13, 8 PM from 2026-11-14; 6 PM close; ordinary and DST days", () => {
    expect(new Date(requestStartAt("2026-10-14")).toISOString()).toBe("2026-10-15T05:00:00.000Z"); // 10 PM PDT
    expect(new Date(requestCloseAt("2026-10-14")).toISOString()).toBe("2026-10-15T01:00:00.000Z");
    expect(new Date(requestStartAt("2026-03-08")).toISOString()).toBe("2026-03-09T05:00:00.000Z"); // spring forward
    expect(new Date(requestStartAt("2026-11-01")).toISOString()).toBe("2026-11-02T06:00:00.000Z"); // fall back
    // The move: the 13th was frozen for 10 PM, the 14th is the first 8 PM night.
    expect(new Date(requestStartAt("2026-11-13")).toISOString()).toBe("2026-11-14T06:00:00.000Z"); // 10 PM PST
    expect(new Date(requestStartAt("2026-11-14")).toISOString()).toBe("2026-11-15T04:00:00.000Z"); // 8 PM PST
    expect(new Date(requestStartAt("2026-12-01")).toISOString()).toBe("2026-12-02T04:00:00.000Z");
    expect(new Date(requestStartAt("2027-03-14")).toISOString()).toBe("2027-03-15T03:00:00.000Z"); // 8 PM PDT, spring forward
    expect(new Date(requestCloseAt("2026-11-14")).toISOString()).toBe("2026-11-15T02:00:00.000Z"); // 6 PM PST
    expect([requestHourOf("2026-11-13"), requestHourOf("2026-11-14")]).toEqual([22, 20]);
    expect([requestHourLabel("2026-11-13"), requestHourLabel("2026-11-14")]).toEqual(["10 PM", "8 PM"]);
    expect(pacificHourLabel(requestStartAt("2026-12-01"))).toBe("8 PM");
  });

  it("a vote counts for tonight until 6 PM Pacific, and for tomorrow from 6 PM", () => {
    const close = requestCloseAt("2026-10-14");
    expect(requestDayAt(close - 1)).toBe("2026-10-14");
    expect(requestDayAt(close)).toBe("2026-10-15");
    expect(requestDayAt(pacificDayBounds("2026-10-14").start)).toBe("2026-10-14");
  });

  it.each(DAYS)("every day built (%s) starts a show exactly on the request hour, and nothing before it runs into it", (day) => {
    const p = buildDay(day, inputs, []);
    const ten = requestStartAt(day);
    const onHour = p.slots.filter((s) => s.requestSlot);
    expect(onHour).toHaveLength(1);
    expect(onHour[0].start).toBe(ten);
    for (const s of p.slots.filter((x) => x.start < ten)) expect(s.end + STATION_ID_SEC * 1000).toBeLessThanOrEqual(ten);
    // The gap left before the hour is never a long silence, and nothing is cut.
    const before = p.slots.filter((x) => x.start < ten);
    const last = before[before.length - 1];
    expect(ten - (last.end + STATION_ID_SEC * 1000)).toBeLessThanOrEqual(TIGHT_MS);
    for (const s of p.slots) expect(s.end).toBe(s.start + Math.round(s.duration * 1000));
    // Filled to midnight after it.
    const end = p.slots[p.slots.length - 1].end + STATION_ID_SEC * 1000;
    expect(end).toBeLessThanOrEqual(p.end);
    expect(p.end - end).toBeLessThanOrEqual(TIGHT_MS);
  });

  it("a show that would run past the hour gives way to one that fits, and still airs after it", () => {
    // 2026-11-20 (8 PM): 6 x 3 h on this date reach 18:00:48; the seventh
    // cannot fit the 1:59:12 left, the 118-minute favorite does (64 s left),
    // and the seventh goes on at 8 PM, in full. Nothing else fits after it.
    const today = Array.from({ length: 9 }, (_, i) => row(`d${i}`, `19${90 + i}-11-20`, 3 * H));
    const short = row("short", "1980-01-01", 118 * 60);
    const p = buildDay("2026-11-20", { catalog: [...today, short], plays: plays([[short, 1]]) }, []);
    const hour = requestStartAt("2026-11-20");
    const titles = p.slots.map((x) => x.title);
    expect(titles).toEqual(["d0", "d1", "d2", "d3", "d4", "d5", "short", "d6"]);
    expect(p.slots[6].end + STATION_ID_SEC * 1000).toBe(hour - 64_000);
    expect(p.slots[7]).toMatchObject({ title: "d6", start: hour, requestSlot: true, kind: "on-this-date" });
    expect(p.slots[7].end).toBe(hour + 3 * H * 1000);
  });

  it("is deterministic: same inputs, same day", () => {
    expect(JSON.stringify(buildDay("2026-10-14", inputs, []))).toBe(JSON.stringify(buildDay("2026-10-14", inputs, [])));
  });

  describe("applyRequest: the winner on the hour, the night packed again", () => {
    const day = "2026-11-20";
    const p = buildDay(day, inputs, []);
    const ten = requestStartAt(day);
    const onDay = new Set(p.slots.map((x) => x.fileHash));
    // An hour-long winner, so the night has shows left after it to shift.
    const winnerRow = CATALOG.find((r) => !onDay.has(r.fileHash) && (r.duration ?? 0) > 50 * 60 && (r.duration ?? 0) < 70 * 60)!;
    const night: RequestNight = { day, fileHash: winnerRow.fileHash, by: "Dogman", place: "Pahrump", votes: 7 };
    const q = applyRequest(p, night, byHash);

    it("leaves everything before the hour exactly as frozen", () => {
      expect(q.slots.filter((x) => x.start < ten)).toEqual(p.slots.filter((x) => x.start < ten));
    });

    it("puts the winner exactly on the hour (8 PM), with who asked and the tally, played in full", () => {
      expect(new Date(ten).toISOString()).toBe("2026-11-21T04:00:00.000Z");
      const r = q.slots.find((x) => x.start === ten)!;
      expect(r).toMatchObject({ kind: "request", fileHash: winnerRow.fileHash, request: { by: "Dogman", place: "Pahrump", votes: 7, day } });
      expect(r.end).toBe(ten + Math.round(winnerRow.duration! * 1000));
      expect(q.slots.filter((x) => x.requestSlot)).toEqual([]);
    });

    it("packs the rest of the night: the frozen night's shows keep their order, every show plays in full, the last ends by midnight", () => {
      const after = q.slots.filter((x) => x.start > ten);
      const frozenAfter = p.slots.filter((x) => x.start >= ten).map((x) => x.fileHash);
      // The frozen order, as a subsequence (one that does not fit is passed over).
      const kept = after.map((x) => x.fileHash).filter((h) => frozenAfter.includes(h));
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.map((h) => frozenAfter.indexOf(h))).toEqual([...kept.map((h) => frozenAfter.indexOf(h))].sort((a, b) => a - b));
      let prevEnd = ten + Math.round(winnerRow.duration! * 1000);
      for (const s of after) {
        expect(s.start).toBe(prevEnd + STATION_ID_SEC * 1000);
        expect(s.end).toBe(s.start + Math.round(s.duration * 1000));
        prevEnd = s.end;
      }
      expect(prevEnd + STATION_ID_SEC * 1000).toBeLessThanOrEqual(q.end);
      expect(q.end - (prevEnd + STATION_ID_SEC * 1000)).toBeLessThanOrEqual(TIGHT_MS);
    });

    it("a three-hour winner is no longer cut at midnight (it was at 10 PM)", () => {
      const long = CATALOG.find((r) => !onDay.has(r.fileHash) && isProgrammable(r) && (r.duration ?? 0) > 3.4 * H && (r.duration ?? 0) < 3.8 * H)!;
      const lq = applyRequest(p, { ...night, fileHash: long.fileHash }, byHash);
      for (const s of lq.slots) expect(s.end).toBe(s.start + Math.round(s.duration * 1000));
      const old = buildDay("2026-10-20", inputs, []);
      const oq = applyRequest(old, { ...night, day: "2026-10-20", fileHash: long.fileHash }, byHash);
      // At 10 PM it still could not be helped: under two hours to midnight.
      expect(oq.slots.find((s) => s.kind === "request")!.end).toBe(oq.end);
    });

    it("never puts a show on twice", () => {
      expect(new Set(q.slots.map((x) => x.fileHash)).size).toBe(q.slots.length);
    });

    it("an empty night (nobody nominated) leaves the day exactly as frozen", () => {
      expect(applyRequest(p, { day, fileHash: null, by: null, place: null, votes: 0 }, byHash)).toBe(p);
      expect(applyRequest(p, null, byHash)).toBe(p);
    });

    it("another day's night changes nothing", () => {
      expect(applyRequest(p, { ...night, day: addDays(day, 1) }, byHash)).toBe(p);
    });

    it("a day frozen before the Request Line (no stand-in): the show running on the hour is cut before it", () => {
      const legacy: DayProgram = {
        ...p,
        slots: [
          { ...p.slots[0], start: ten - 3600_000, end: ten + 3600_000, requestSlot: undefined },
          { ...p.slots[1], start: ten + 3600_000 + 8000, end: ten + 3600_000 + 8000 + p.slots[1].duration * 1000, requestSlot: undefined },
        ],
      };
      const r = applyRequest(legacy, night, byHash);
      expect(r.slots[0].end).toBe(ten - STATION_ID_SEC * 1000);
      expect(r.slots[1]).toMatchObject({ kind: "request", start: ten });
      expect(r.slots[2].start).toBe(ten + Math.round(winnerRow.duration! * 1000) + STATION_ID_SEC * 1000);
      expect(r.slots[2].end).toBe(r.slots[2].start + Math.round(r.slots[2].duration * 1000));
    });
  });
});

describe("only Art Bell's own nights air (2026-11-12, docs/hosts.md)", () => {
  const byHash = new Map(CATALOG.map((r) => [r.fileHash, r]));
  const NOORY = "archive:ultimate-ultimate-art-bell-collection:2001-11-12 - Coast to Coast AM with Art Bell - Eugene Mallove - Infinite Energy Magazine.mp3";

  it("the George Noory night of 2001-11-12 is excluded, and is not airable", () => {
    expect(NOT_ART_HOSTED.has(NOORY)).toBe(true);
    expect(isAirable(byHash.get(NOORY)!)).toBe(false);
  });

  it("no day built from the real catalog puts on a show that is not Art's: the 12th of November included", () => {
    let history: DayProgram[] = [];
    for (let i = 0; i < 40; i++) {
      const day = addDays("2026-11-01", i);
      const p = buildDay(day, { catalog: CATALOG, plays: new Map(CATALOG.map((r) => [communityKey(r)!, 1000])) }, history);
      history = [p, ...history];
      for (const s of p.slots) expect(NOT_ART_HOSTED.has(s.fileHash)).toBe(false);
      for (const h of p.ranking) expect(NOT_ART_HOSTED.has(h)).toBe(false);
    }
    // A control: the same file under a hash the list does not name airs on
    // its date, so the exclusion (not the packing) is what kept it off.
    const renamed = CATALOG.map((r) => (r.fileHash === NOORY ? { ...r, fileHash: "archive:control:noory.mp3" } : r));
    expect(buildDay("2026-11-12", { catalog: renamed, plays: new Map() }, []).slots.some((s) => s.fileHash === "archive:control:noory.mp3")).toBe(true);
    expect(buildDay("2026-11-12", { catalog: CATALOG, plays: new Map() }, []).slots.some((s) => s.airDate === "2001-11-12")).toBe(false);
  });

  it("applyHostSwap: a day frozen with a non-Art show swaps it, slot times unchanged", () => {
    const p = buildDay("2026-11-20", { catalog: CATALOG, plays: new Map() }, []);
    const frozen: DayProgram = { ...p, slots: p.slots.map((s, i) => (i === 1 ? { ...s, fileHash: NOORY } : s)) };
    const q = applyHostSwap(frozen, byHash);
    expect(q.slots[1]).toMatchObject({ kind: "host-swap", replaces: NOORY, start: frozen.slots[1].start });
    expect(q.slots[1].end).toBeLessThanOrEqual(frozen.slots[1].end);
    expect(q.slots.filter((s, i) => i !== 1)).toEqual(frozen.slots.filter((s, i) => i !== 1));
    expect(applyHostSwap(p, byHash)).toBe(p);
  });

  it("a nominated non-Art show never airs: applyRequest leaves the stand-in", () => {
    const p = buildDay("2026-11-20", { catalog: CATALOG, plays: new Map() }, []);
    expect(applyRequest(p, { day: "2026-11-20", fileHash: NOORY, by: "x", place: null, votes: 3 }, byHash)).toBe(p);
  });
});

describe("packer: a pick must leave time another show can close", () => {
  it("accepts a pick that leaves almost nothing, or what one or two shows close, and refuses one that leaves a hole", () => {
    const m = 60_000;
    const gap = STATION_ID_SEC * 1000;
    const pk = packer([30 * m, 45 * m, 180 * m]);
    // 60 min room, a 59-minute show: 52 s left.
    expect(pk.fits(59 * m, 60 * m)).toBe(true);
    // 4 h room, a 3 h show: 59:52 left, closed by none of 30/45 alone, nor 30+45 (75:16): refused.
    expect(pk.fits(180 * m, 240 * m)).toBe(false);
    // 4 h room, 2 h 44 m: 75:52 left = 30 + 45 + two IDs, within TIGHT_MS.
    expect(pk.fits(164 * m, 240 * m)).toBe(true);
    // Past OPEN (6 h) anything that fits is fine.
    expect(pk.fits(30 * m, 10 * 60 * m)).toBe(true);
    // Never past the room.
    expect(pk.fits(60 * m, 60 * m)).toBe(false);
    expect(pk.fits(60 * m - gap, 60 * m)).toBe(true);
    // A taken length no longer counts.
    pk.take(45 * m);
    expect(pk.fits(164 * m, 240 * m)).toBe(false);
  });
});
