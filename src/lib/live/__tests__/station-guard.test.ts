import { describe, expect, it } from "vitest";
import {
  applyOverrides,
  applyVerifySwap,
  buildDay,
  STATION_ID_SEC,
  type BuildInputs,
  type CatalogRow,
  type DayProgram,
} from "../schedule";
import { communityKey } from "@/lib/utils/community-key";

/**
 * The station guard (2026-10-11): a file that failed its frame walk never
 * airs (`applyVerifySwap`, frozen with the day), and a show listeners are
 * failing on is cut where it is (`applyOverrides`, applied at read time).
 * Hand-built catalogs, so every answer can be worked out on paper.
 */

const H = 3600;
function row(name: string, duration = 2 * H): CatalogRow {
  return {
    fileHash: `archive:coll:${name}.mp3`,
    fileName: `${name}.mp3`,
    archiveIdentifier: "coll",
    title: name,
    airDate: "1990-01-01",
    duration,
    sourceUrl: `https://archive.org/download/coll/${name}.mp3`,
  };
}
const catalog = Array.from({ length: 40 }, (_, i) => row(`s${String(i).padStart(2, "0")}`, (2 + (i % 3)) * H));
const inputs: BuildInputs = { catalog, plays: new Map(catalog.map((r, i) => [communityKey(r)!, 100 - i])) };
const byHash = new Map(catalog.map((r) => [r.fileHash, r]));
const program = buildDay("2026-06-10", inputs, []);
const scheduled = program.slots.map((s) => s.fileHash);
const offDay = program.ranking.filter((h) => !scheduled.includes(h));

describe("verify swap: a file that failed its walk never airs", () => {
  const bad = new Set([scheduled[1]]);
  const ok = new Set(offDay);

  it("replaces only the bad slot, keeps its times, and records what it replaced", () => {
    const p = applyVerifySwap(program, { bad, ok }, byHash, null);
    expect(p.slots).toHaveLength(program.slots.length);
    p.slots.forEach((s, i) => {
      const orig = program.slots[i];
      expect(s.start).toBe(orig.start);
      expect(s.end).toBeLessThanOrEqual(orig.end);
      if (i === 1) {
        expect(s).toMatchObject({ kind: "verify-swap", replaces: orig.fileHash });
        expect(ok.has(s.fileHash)).toBe(true);
      } else expect(s).toBe(orig);
    });
  });

  it("puts on only a file that passed a walk, never an unwalked one", () => {
    const onlyOne = new Set([offDay[offDay.length - 1]]);
    const p = applyVerifySwap(program, { bad, ok: onlyOne }, byHash, null);
    expect(p.slots[1].fileHash).toBe(offDay[offDay.length - 1]);
  });

  it("prefers a show pinned on the mirror", () => {
    const len = program.slots[1].end - program.slots[1].start;
    const fits = offDay.filter((h) => byHash.get(h)!.duration! * 1000 >= len);
    const last = fits[fits.length - 1];
    const unpinned = applyVerifySwap(program, { bad, ok }, byHash, null);
    expect(unpinned.slots[1].fileHash).toBe(fits[0]);
    const p = applyVerifySwap(program, { bad, ok }, byHash, new Set([last]));
    expect(p.slots[1].fileHash).toBe(last);
  });

  it("a day with nothing known bad is returned as it was (control)", () => {
    expect(applyVerifySwap(program, { bad: new Set(), ok }, byHash, null)).toBe(program);
  });

  it("is deterministic", () => {
    const a = applyVerifySwap(program, { bad, ok }, byHash, null);
    const b = applyVerifySwap(program, { bad: new Set(bad), ok: new Set([...ok].reverse()) }, byHash, null);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("breaker overrides: a cut show ends where it was cut", () => {
  const p: DayProgram = program;
  const A = p.slots[2];
  const cutAt = A.start + 40 * 60_000;
  const replacement = offDay[0];

  it("ends the slot at the cut, and the replacement plays one station ID later to the slot's old end", () => {
    const slots = applyOverrides(p.slots, [{ slotStart: A.start, fileHash: A.fileHash, cutAt, replacement }], byHash);
    expect(slots).toHaveLength(p.slots.length + 1);
    expect(slots[2]).toMatchObject({ fileHash: A.fileHash, start: A.start, end: cutAt });
    expect(slots[3]).toMatchObject({ fileHash: replacement, kind: "breaker-swap", replaces: A.fileHash, start: cutAt + STATION_ID_SEC * 1000 });
    expect(slots[3].end).toBeLessThanOrEqual(A.end);
    // Nothing else moves.
    expect(slots.slice(4)).toEqual(p.slots.slice(3));
    expect(slots.slice(0, 2)).toEqual(p.slots.slice(0, 2));
  });

  it("with no replacement, the station ID holds to the next slot", () => {
    const slots = applyOverrides(p.slots, [{ slotStart: A.start, fileHash: A.fileHash, cutAt, replacement: null }], byHash);
    expect(slots).toHaveLength(p.slots.length);
    expect(slots[2].end).toBe(cutAt);
  });

  it("an override for another slot, or another file in that slot, changes nothing", () => {
    expect(applyOverrides(p.slots, [{ slotStart: A.start + 1, fileHash: A.fileHash, cutAt, replacement }], byHash)).toEqual(p.slots);
    expect(applyOverrides(p.slots, [{ slotStart: A.start, fileHash: "archive:coll:other.mp3", cutAt, replacement }], byHash)).toEqual(p.slots);
  });
});
